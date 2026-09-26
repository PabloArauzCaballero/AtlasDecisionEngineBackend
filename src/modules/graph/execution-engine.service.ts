/**
 * Deterministic graph interpreter. It enforces step/output contracts and emits explainable traces;
 * infrastructure resolution and persistence remain outside the engine.
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain-exception';
import { MetricsService } from '../../common/observability/metrics.service';
import { ExpressionEvaluator } from './expression-evaluator';
import { renderTemplate } from './template-reference';
import { ScriptNodeRunnerService, type ScriptLanguage } from './script-node-runner.service';
import { IntermediateScope, sanitize } from './intermediate-scope';
import {
  executeCalculatedField,
  type ExecutableCalculatedField,
} from '../calculated-fields/calculated-field-runtime';
import { intermediateAssignmentsOf } from './validators/graph-intermediate.validator';
import { requireWorkerCall } from './worker-call';
import type {
  ArtifactReferenceResolver,
  CalculatedFieldCallSnapshot,
  CalculatedFieldTraceEntry,
  CompiledDecisionArtifact,
  DecisionReasonResult,
  EngineExecutionResult,
  GraphActionSnapshot,
  GraphEdgeSnapshot,
  GraphNodeSnapshot,
  LiveStepEvent,
  NestedExecutionTraceEntry,
  NestedReferenceCursor,
  WorkerCallSnapshot,
  WorkerCallTraceEntry,
  WorkerServiceInvoker,
  WorkerServiceOutcome,
} from './graph.types';

/**
 * Convierte a número o detiene la ejecución.
 *
 * `Number()` a secas devuelve `NaN` para cualquier cosa que no sea numérica, y `NaN` no
 * levanta ninguna alarma: se propaga por las sumas, sobrevive a `state.score`, y al
 * serializar la respuesta `JSON.stringify` lo convierte en `null`. El solicitante recibía
 * entonces `{"status":"SUCCEEDED","outcome":"APPROVED","score":null}` — una decisión que el
 * motor declara correcta sobre un número que nunca llegó a calcular.
 *
 * Es la misma regla que ya aplicaba `ExpressionEvaluator.asNumber` a las expresiones; lo que
 * faltaba era aplicarla a la otra puerta por la que entran números al estado de la decisión:
 * la configuración de los nodos SCORE y las acciones SET_SCORE/ADD_SCORE/SET_LIMIT, que se
 * escriben a mano en el editor y por tanto son igual de capaces de traer un valor no
 * numérico. `Infinity` se rechaza por el mismo motivo que `NaN`: no es un importe ni una
 * puntuación que se pueda persistir ni comparar.
 */
function requireFiniteNumber(value: unknown, code: string, what: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new DomainException(
      'NON_NUMERIC_DECISION_VALUE',
      `${what} de ${code} no produjo un número finito`,
    );
  }
  return parsed;
}

interface MutableExecutionState {
  outcome: string;
  score?: number;
  riskBand?: string;
  limit?: number;
  output: Record<string, unknown>;
  reasons: DecisionReasonResult[];
  primaryResult?: EngineExecutionResult['primaryResult'];
  manualReview?: EngineExecutionResult['manualReview'];
  /**
   * Ámbito de las variables intermedias de ESTA ejecución. Vive en el estado, no en
   * el servicio: el servicio es un singleton compartido entre peticiones y ahí una
   * intermedia sobreviviría a su ejecución, que es justo lo que §2.1 prohíbe.
   */
  intermediates: IntermediateScope;
  /** Nodo en evaluación; determina qué intermedias son legibles y quién las consume. */
  currentNodeKey: string;
  /** Invocaciones a campos calculados de esta ejecución, en orden (§12). */
  calculatedFieldCalls: CalculatedFieldTraceEntry[];
  /** Llamadas a servicios de worker de esta ejecución, en orden. */
  workerCalls: WorkerCallTraceEntry[];
}

@Injectable()
export class ExecutionEngineService {
  private readonly maxSteps: number;

  constructor(
    private readonly expressions: ExpressionEvaluator,
    config: ConfigService,
    private readonly scripts: ScriptNodeRunnerService,
    private readonly metrics: MetricsService,
  ) {
    this.maxSteps = config.get<number>('MAX_EXECUTION_STEPS') ?? 256;
  }

  async execute(
    compiled: CompiledDecisionArtifact,
    variables: Record<string, unknown>,
    referenceResolver?: ArtifactReferenceResolver,
    // The nesting position this execute() call itself runs at. Omitted by root callers
    // (RuntimeService, SimulationService), who get the default depth-1/no-parent cursor
    // below. NestedTreeExecutionService passes the cursor for the nested call it is
    // about to make, so trace entries get globally unique, correctly-parented sequence
    // numbers across the whole recursive tree — see graph.types.ts.
    nestedCursor?: NestedReferenceCursor,
    // Fase 8 — live execution. Fired synchronously as each node starts/finishes;
    // omitted by every existing caller (RuntimeService, SimulationService,
    // TestCaseExecutorService), so this changes nothing for them.
    onStep?: (event: LiveStepEvent) => void,
    // Quién ejecuta la llamada de un nodo WORKER. Mismo criterio que el resolutor de
    // referencias: argumento de llamada, nunca dependencia de constructor, para que el
    // motor no dependa del módulo de workers. Omitirlo solo afecta a los grafos que
    // tengan nodos WORKER, y ahí falla cerrado.
    workerInvoker?: WorkerServiceInvoker,
  ): Promise<EngineExecutionResult> {
    const state: MutableExecutionState = {
      outcome: 'NO_DECISION',
      output: {},
      reasons: [],
      intermediates: new IntermediateScope(compiled.intermediates ?? []),
      currentNodeKey: compiled.startNodeKey,
      calculatedFieldCalls: [],
      workerCalls: [],
    };
    const trace: EngineExecutionResult['trace'] = [];
    const visitedNodeKeys: string[] = [];
    const traversedEdgeKeys: string[] = [];
    const nestedExecutions: NestedExecutionTraceEntry[] = [];
    const cursor = nestedCursor ?? { sequence: { value: 0 }, parentSequence: null, depth: 1 };
    let currentKey: string | undefined = compiled.startNodeKey;
    let terminalNodeKey: string | undefined;

    for (let stepIndex = 0; currentKey && stepIndex < this.maxSteps; stepIndex += 1) {
      const started = process.hrtime.bigint();
      const node = compiled.nodes[currentKey];
      if (!node)
        throw new DomainException(
          'RUNTIME_NODE_NOT_FOUND',
          `Compiled node ${currentKey} not found`,
        );
      visitedNodeKeys.push(node.key);
      state.currentNodeKey = node.key;
      // Antes de ejecutar nada: toda intermedia que nazca en este nodo queda fechada en
      // ESTE paso, que es el mismo índice con el que la traza lo publica (§3.1).
      state.intermediates.enterStep(stepIndex);
      const evaluation: Record<string, unknown> = {};
      // Foto de las intermedias ANTES de ejecutar el nodo (§3.1: "variables
      // intermedias disponibles antes de la ejecución").
      const intermediatesBefore = state.intermediates.snapshot();
      onStep?.({ status: 'RUNNING', nodeKey: node.key, nodeType: node.type });

      try {
        if (node.type === 'SCORE') {
          this.evaluateScoreNode(node, compiled, variables, state, evaluation);
        }
        if (node.type === 'ACTION') {
          this.executeActions(node, compiled, variables, state, evaluation);
        }
        if (node.type === 'WORKER') {
          await this.invokeWorkerService(node, variables, state, evaluation, workerInvoker);
        }
        if (node.type === 'RESULT') {
          await this.evaluateResultNode(
            node,
            compiled,
            variables,
            state,
            evaluation,
            referenceResolver,
            cursor,
            nestedExecutions,
          );
        }
        if (node.type === 'MANUAL_REVIEW') {
          /*
           * Un nodo que TERMINA la ejecución tiene que poder escribir las salidas.
           *
           * El mapeo de salidas sólo se aplicaba en `RESULT`, así que un artefacto que
           * derivaba a una persona terminaba sin sus salidas obligatorias y el motor lo
           * rechazaba con `REQUIRED_OUTPUT_MISSING`: quien llamaba recibía un error, no
           * un «esto lo ve un humano». Encolar el caso y contestar al que llama son dos
           * cosas distintas y hacen falta las dos.
           *
           * Se reutiliza `evaluateResultNode` en vez de duplicar el mapeo, y sólo cuando
           * el nodo declara `MAPPING`: un `MANUAL_REVIEW` sin salidas declaradas sigue
           * comportándose como antes.
           */
          if (node.config.mode === 'MAPPING') {
            await this.evaluateResultNode(
              node,
              compiled,
              variables,
              state,
              evaluation,
              referenceResolver,
              cursor,
              nestedExecutions,
            );
          }
          state.outcome = 'MANUAL_REVIEW';
          state.manualReview = {
            queueCode: String(node.config.queueCode ?? 'CREDIT_REVIEW'),
            priority: requireFiniteNumber(node.config.priority ?? 100, node.key, 'La prioridad'),
            slaMinutes: requireFiniteNumber(
              node.config.slaMinutes ?? 240,
              node.key,
              'El SLA en minutos',
            ),
            evidence: renderTemplate(
              (node.config.evidence ?? {}) as Record<string, unknown>,
              this.context(variables, state),
            ) as Record<string, unknown>,
          };
          terminalNodeKey = node.key;
        }
        if (node.type === 'END') {
          state.outcome = String(node.config.outcome ?? state.outcome);
          terminalNodeKey = node.key;
        }

        // Los campos calculados corren ANTES de las asignaciones de intermedias: una
        // asignación puede combinar el resultado de un campo con otros valores, pero un
        // campo nunca depende de una asignación posterior del mismo nodo.
        await this.applyCalculatedFieldCalls(node, compiled, variables, state, evaluation);

        // Las escrituras de intermedias van DESPUÉS de la lógica del nodo: una
        // asignación puede depender del score o del output que el propio nodo acaba
        // de calcular.
        this.applyIntermediateWrites(node, variables, state, evaluation);

        const terminalByAction = node.actions.some(
          (reference) => compiled.actions[reference.code]?.terminal,
        );
        if (
          node.terminal ||
          node.type === 'END' ||
          node.type === 'RESULT' ||
          node.type === 'MANUAL_REVIEW' ||
          terminalByAction
        ) {
          terminalNodeKey = node.key;
          const durationUs = Number((process.hrtime.bigint() - started) / 1000n);
          trace.push({
            nodeId: node.id,
            nodeKey: node.key,
            nodeType: node.type,
            evaluation,
            durationUs,
            variableState: this.nodeVariableState(
              node,
              compiled,
              variables,
              state,
              intermediatesBefore,
              { durationUs },
            ),
          });
          onStep?.({ status: 'COMPLETED', nodeKey: node.key, nodeType: node.type, durationUs });
          currentKey = undefined;
          break;
        }

        const selected = this.selectEdge(
          compiled.edgesByNode[node.key] ?? [],
          compiled,
          variables,
          state,
          evaluation,
        );
        if (!selected) {
          throw new DomainException(
            'NO_MATCHING_EDGE',
            `No outgoing edge matched node ${node.key}`,
          );
        }
        traversedEdgeKeys.push(selected.key);
        const durationUs = Number((process.hrtime.bigint() - started) / 1000n);
        trace.push({
          nodeId: node.id,
          nodeKey: node.key,
          nodeType: node.type,
          branchTaken: selected.key,
          evaluation,
          durationUs,
          variableState: this.nodeVariableState(
            node,
            compiled,
            variables,
            state,
            intermediatesBefore,
            { durationUs },
          ),
        });
        onStep?.({
          status: 'COMPLETED',
          nodeKey: node.key,
          nodeType: node.type,
          branchTaken: selected.key,
          // Every other outgoing edge, whether or not its condition was actually
          // evaluated (short-circuit evaluation in selectEdge() may skip some) —
          // for a "ramas descartadas" visualization the viewer wants every branch
          // not walked, not just the ones formally condition-checked.
          discardedEdgeKeys: (compiled.edgesByNode[node.key] ?? [])
            .map((edge) => edge.key)
            .filter((key) => key !== selected.key),
          durationUs,
        });
        currentKey = selected.to;
      } catch (error) {
        // Sin esto, el nodo que rompe la decisión era justo el único que no aparecía en
        // la traza: quedaba un hueco donde más falta hace la evidencia.
        const durationUs = Number((process.hrtime.bigint() - started) / 1000n);
        const failure = {
          code: error instanceof DomainException ? error.code : 'NODE_EXECUTION_FAILED',
          message: error instanceof Error ? error.message : String(error),
        };
        trace.push({
          nodeId: node.id,
          nodeKey: node.key,
          nodeType: node.type,
          evaluation,
          durationUs,
          variableState: this.nodeVariableState(
            node,
            compiled,
            variables,
            state,
            intermediatesBefore,
            { durationUs, error: failure },
          ),
        });
        onStep?.({
          status: 'ERROR',
          nodeKey: node.key,
          nodeType: node.type,
          durationUs,
          errorMessage: failure.message,
        });
        throw error;
      }
    }

    if (currentKey) {
      throw new DomainException(
        'MAX_EXECUTION_STEPS_EXCEEDED',
        `Execution exceeded ${this.maxSteps} steps`,
      );
    }
    if (!terminalNodeKey) {
      throw new DomainException(
        'EXECUTION_WITHOUT_TERMINAL',
        'Execution ended without a terminal node',
      );
    }

    this.finalizeOutputContract(compiled, state);
    this.recordIntermediateLifecycle(state);

    return {
      status:
        state.outcome === 'NO_DECISION' && !this.outputContracts(compiled).length
          ? 'NO_DECISION'
          : 'SUCCEEDED',
      outcome: state.outcome,
      score: state.score,
      riskBand: state.riskBand,
      limit: state.limit,
      output: {
        ...state.output,
        outcome: state.outcome,
        ...(state.score !== undefined ? { score: state.score } : {}),
        ...(state.riskBand !== undefined ? { riskBand: state.riskBand } : {}),
        ...(state.limit !== undefined ? { limit: state.limit } : {}),
      },
      primaryResult: state.primaryResult,
      reasons: [...state.reasons].sort(
        (a, b) => a.priority - b.priority || a.code.localeCompare(b.code),
      ),
      trace,
      visitedNodeKeys,
      traversedEdgeKeys,
      terminalNodeKey,
      manualReview: state.manualReview,
      nestedExecutions,
      calculatedFieldCalls: state.calculatedFieldCalls,
      workerCalls: state.workerCalls,
    };
  }

  /**
   * Ejecuta la llamada a servicio que declara un nodo `WORKER`.
   *
   * El nodo no devuelve nada al contrato público: lo que trae el servicio se proyecta a
   * variables intermedias, que es lo que después leen las condiciones, los scores y las
   * expresiones. Así un dato de un worker entra al motor por la misma puerta —con su tipo,
   * su autorización de escritura y su política de traza— que cualquier valor calculado.
   */
  private async invokeWorkerService(
    node: GraphNodeSnapshot,
    variables: Record<string, unknown>,
    state: MutableExecutionState,
    evaluation: Record<string, unknown>,
    invoker: WorkerServiceInvoker | undefined,
  ): Promise<void> {
    const call = requireWorkerCall(node);
    if (!invoker) {
      throw new DomainException(
        'WORKER_SERVICE_NOT_CONFIGURED',
        `El nodo ${node.key} llama al servicio ${call.service}, pero esta ejecución no recibió un invocador de servicios`,
      );
    }

    const started = Date.now();
    let outcome: WorkerServiceOutcome;
    try {
      outcome = await invoker.invoke({
        service: call.service,
        operation: call.operation,
        nodeKey: node.key,
        arguments: this.resolveWorkerArguments(call, variables, state),
        timeoutMs: call.timeoutMs,
      });
    } catch (error) {
      const errorCode = error instanceof DomainException ? error.code : 'WORKER_SERVICE_FAILED';
      const durationMs = Date.now() - started;
      if (call.onError === 'FAIL') {
        state.workerCalls.push({
          nodeKey: node.key,
          service: call.service,
          operation: call.operation,
          status: 'FAILED',
          durationMs,
          outputs: [],
          warnings: [],
          errorCode,
        });
        this.metrics.recordWorkerCall(call.service, call.operation, 'ERROR', durationMs);
        throw error;
      }
      // `CONTINUE`: el algoritmo sigue con lo que el autor declaró como valor por defecto,
      // y `call.status` deja el fallo a la vista para que una rama pueda desviarse por él.
      const written = this.applyWorkerOutputs(
        call,
        { result: {}, call: { status: 'FAILED', errorCode, durationMs, warningCount: 0 } },
        node,
        variables,
        state,
      );
      state.workerCalls.push({
        nodeKey: node.key,
        service: call.service,
        operation: call.operation,
        status: 'FAILED',
        durationMs,
        outputs: written,
        warnings: [],
        errorCode,
      });
      this.metrics.recordWorkerCall(call.service, call.operation, 'ERROR', durationMs);
      evaluation.worker = {
        service: call.service,
        operation: call.operation,
        status: 'FAILED',
        errorCode,
        outputs: written,
      };
      return;
    }

    const written = this.applyWorkerOutputs(
      call,
      {
        result: outcome.result,
        call: {
          status: outcome.status,
          errorCode: null,
          durationMs: outcome.durationMs,
          warningCount: outcome.warnings.length,
        },
      },
      node,
      variables,
      state,
    );
    state.workerCalls.push({
      nodeKey: node.key,
      service: call.service,
      operation: call.operation,
      status: outcome.status,
      durationMs: outcome.durationMs,
      outputs: written,
      warnings: outcome.warnings,
    });
    this.metrics.recordWorkerCall(call.service, call.operation, outcome.status, outcome.durationMs);
    evaluation.worker = {
      service: call.service,
      operation: call.operation,
      status: outcome.status,
      durationMs: outcome.durationMs,
      warnings: outcome.warnings,
      outputs: written,
    };
  }

  /** Alimenta cada argumento del servicio desde el contexto del grafo. */
  private resolveWorkerArguments(
    call: WorkerCallSnapshot,
    variables: Record<string, unknown>,
    state: MutableExecutionState,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    for (const [name, binding] of Object.entries(call.arguments)) {
      const context = this.context(variables, state);
      switch (binding.source) {
        case 'LITERAL':
          resolved[name] = binding.value;
          break;
        case 'EXPRESSION':
          resolved[name] = this.expressions.evaluate(binding.expression, context);
          break;
        case 'TEMPLATE':
          resolved[name] = renderTemplate(binding.value, context);
          break;
        case 'INTERMEDIATE':
          resolved[name] = this.expressions.evaluate(
            { var: `intermediate.${binding.path ?? ''}` },
            context,
          );
          break;
        default:
          resolved[name] = this.expressions.evaluate({ var: binding.path ?? '' }, context);
      }
    }
    return resolved;
  }

  /**
   * Proyecta la respuesta del servicio sobre las intermedias declaradas.
   *
   * Las rutas se resuelven contra `{ result, call }` y no contra la respuesta pelada: así
   * un servicio que devuelva su propio campo `status` no tapa el estado de la llamada, que
   * es justo el dato del que suele colgar la rama de contingencia.
   */
  private applyWorkerOutputs(
    call: WorkerCallSnapshot,
    envelope: { result: Record<string, unknown>; call: Record<string, unknown> },
    node: GraphNodeSnapshot,
    variables: Record<string, unknown>,
    state: MutableExecutionState,
  ): string[] {
    const context = { ...this.context(variables, state), ...envelope };
    const written: string[] = [];
    for (const output of call.outputs) {
      const raw =
        output.source === 'EXPRESSION'
          ? this.expressions.evaluate(output.expression, context)
          : this.expressions.evaluate({ var: output.path ?? '' }, context);
      const value = raw === undefined || raw === null ? (output.defaultValue ?? null) : raw;
      state.intermediates.write(output.intermediateCode, node.key, value);
      written.push(output.intermediateCode);
    }
    return written.sort();
  }

  private async evaluateResultNode(
    node: GraphNodeSnapshot,
    compiled: CompiledDecisionArtifact,
    variables: Record<string, unknown>,
    state: MutableExecutionState,
    evaluation: Record<string, unknown>,
    referenceResolver: ArtifactReferenceResolver | undefined,
    cursor: NestedReferenceCursor,
    nestedExecutions: NestedExecutionTraceEntry[],
  ): Promise<void> {
    const mode = String(node.config.mode ?? 'MAPPING').toUpperCase();
    const values: Record<string, unknown> = {};
    if (mode === 'SCRIPT') {
      const script = (node.config.script ?? {}) as Record<string, unknown>;
      const language = String(script.language ?? '').toUpperCase() as ScriptLanguage;
      if (language !== 'JAVASCRIPT' && language !== 'PYTHON') {
        throw new DomainException(
          'RESULT_SCRIPT_LANGUAGE_INVALID',
          // `String(...)`: el `as ScriptLanguage` de arriba hace creer al compilador que
          // aquí ya no queda ningún valor posible. Esta guarda es justamente la que
          // comprueba que el aserto era cierto.
          `Unsupported RESULT script language ${String(language)}`,
        );
      }
      Object.assign(
        values,
        await this.scripts.execute(
          language,
          String(script.source ?? ''),
          this.context(variables, state),
        ),
      );
    } else if (mode === 'REFERENCE') {
      if (!referenceResolver) {
        throw new DomainException(
          'NESTED_REFERENCE_NOT_CONFIGURED',
          `RESULT node ${node.key} invokes a nested artifact reference, but no reference resolver was supplied to this execution`,
        );
      }
      const resolution = await referenceResolver.resolve(
        compiled.version.id,
        node.key,
        this.context(variables, state),
        cursor,
      );
      nestedExecutions.push(...resolution.trace);
      const outputAssignments = Array.isArray(node.config.outputAssignments)
        ? node.config.outputAssignments
        : [];
      for (const raw of outputAssignments) {
        const assignment = raw as Record<string, unknown>;
        const outputCode = String(assignment.outputCode ?? '');
        const childOutputCode = String(assignment.childOutputCode ?? '');
        values[outputCode] = resolution.output[childOutputCode];
      }
      evaluation.reference = { nodeKey: node.key, outputCount: outputAssignments.length };
    } else if (mode === 'MAPPING') {
      const assignments = Array.isArray(node.config.assignments) ? node.config.assignments : [];
      for (const raw of assignments) {
        const assignment = raw as Record<string, unknown>;
        const outputCode = String(assignment.outputCode ?? assignment.target ?? '');
        const source = String(assignment.source ?? 'LITERAL').toUpperCase();
        let value: unknown;
        if (source === 'EXPRESSION') {
          value = this.expressions.evaluate(
            assignment.expression ?? assignment.valueExpression,
            this.context(variables, state),
          );
        } else if (source === 'VARIABLE') {
          value = this.expressions.evaluate(
            { var: String(assignment.variablePath ?? assignment.path ?? '') },
            this.context(variables, state),
          );
        } else if (source === 'TEMPLATE') {
          value = renderTemplate(assignment.value, this.context(variables, state));
        } else {
          value = assignment.value;
        }
        values[outputCode] = value;
      }
    } else {
      throw new DomainException('RESULT_MODE_INVALID', `Unsupported RESULT mode ${mode}`);
    }

    for (const [code, value] of Object.entries(values)) {
      this.setOutputValue(compiled, state, code, value);
    }
    evaluation.resultMode = mode;
    evaluation.outputs = Object.keys(values).sort();
  }

  private setOutputValue(
    compiled: CompiledDecisionArtifact,
    state: MutableExecutionState,
    code: string,
    value: unknown,
  ): void {
    const contract = this.outputContracts(compiled).find((candidate) => candidate.code === code);
    if (!contract) {
      throw new DomainException('UNDECLARED_OUTPUT', `RESULT node wrote undeclared output ${code}`);
    }
    this.assertOutputType(code, contract.dataType, value, contract.nullable);
    state.output[code] = value;
    if (code === 'score' && value !== null) state.score = Number(value);
    if (code === 'riskBand' && value !== null) state.riskBand = String(value);
    if (code === 'limit' && value !== null) state.limit = Number(value);
    if (contract.usageType === 'OUTPUT_PRIMARY') {
      const legacyOutcome = value === null || value === undefined ? 'NO_DECISION' : String(value);
      if (legacyOutcome.length > 80) {
        throw new DomainException(
          'PRIMARY_OUTPUT_TOO_LONG',
          `Primary output ${code} exceeds 80 characters`,
        );
      }
      state.primaryResult = { code, value };
      state.outcome = legacyOutcome;
    }
  }

  private finalizeOutputContract(
    compiled: CompiledDecisionArtifact,
    state: MutableExecutionState,
  ): void {
    for (const contract of this.outputContracts(compiled)) {
      if (state.output[contract.code] === undefined && contract.defaultValue !== undefined) {
        this.setOutputValue(compiled, state, contract.code, contract.defaultValue);
      }
      if (state.output[contract.code] === undefined && contract.required && !contract.nullable) {
        this.metrics.recordMissingRequiredOutput(compiled.artifact.code);
        throw new DomainException(
          'REQUIRED_OUTPUT_MISSING',
          `Execution finished without required output ${contract.code}`,
        );
      }
    }
  }

  private outputContracts(compiled: CompiledDecisionArtifact) {
    return compiled.variables.filter((variable) =>
      String(variable.usageType ?? '').startsWith('OUTPUT'),
    );
  }

  private assertOutputType(
    code: string,
    dataType: string,
    value: unknown,
    nullable: boolean,
  ): void {
    if (value === null || value === undefined) {
      if (nullable) return;
      throw new DomainException('OUTPUT_TYPE_INVALID', `Output ${code} cannot be null`);
    }
    const type = dataType.toUpperCase();
    const valid =
      (['INTEGER', 'INT', 'NUMBER', 'DECIMAL', 'FLOAT'].includes(type) &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (!['INTEGER', 'INT'].includes(type) || Number.isInteger(value))) ||
      (['STRING', 'TEXT', 'ENUM', 'DATE', 'DATETIME'].includes(type) &&
        typeof value === 'string') ||
      (['BOOLEAN', 'BOOL'].includes(type) && typeof value === 'boolean') ||
      (['OBJECT', 'JSON'].includes(type) && typeof value === 'object' && !Array.isArray(value)) ||
      (['ARRAY', 'LIST'].includes(type) && Array.isArray(value));
    if (!valid) {
      throw new DomainException('OUTPUT_TYPE_INVALID', `Output ${code} must match ${dataType}`);
    }
  }

  private evaluateScoreNode(
    node: GraphNodeSnapshot,
    compiled: CompiledDecisionArtifact,
    variables: Record<string, unknown>,
    state: MutableExecutionState,
    evaluation: Record<string, unknown>,
  ): void {
    let score = requireFiniteNumber(
      node.config.baseScore ?? state.score ?? 0,
      node.key,
      'La puntuación base',
    );
    const components = Array.isArray(node.config.components) ? node.config.components : [];
    const applied: Array<{ conditionCode?: string; points: number }> = [];
    for (const raw of components) {
      const component = raw as Record<string, unknown>;
      const conditionCode = component.conditionCode ? String(component.conditionCode) : undefined;
      const condition = conditionCode ? compiled.conditions[conditionCode] : undefined;
      const matches = condition
        ? Boolean(this.expressions.evaluate(condition.expression, this.context(variables, state)))
        : true;
      if (matches) {
        const points = requireFiniteNumber(
          component.pointsExpression
            ? this.expressions.evaluate(component.pointsExpression, this.context(variables, state))
            : (component.points ?? 0),
          conditionCode ?? node.key,
          'El componente de puntuación',
        );
        score += points;
        applied.push({ conditionCode, points });
      }
    }
    if (node.config.scoreExpression) {
      score = requireFiniteNumber(
        this.expressions.evaluate(node.config.scoreExpression, this.context(variables, state)),
        node.key,
        'La expresión de puntuación',
      );
    }
    state.score = score;
    this.publishOutput(compiled, state, 'score', score, false);
    evaluation.score = score;
    evaluation.appliedComponents = applied;
  }

  private executeActions(
    node: GraphNodeSnapshot,
    compiled: CompiledDecisionArtifact,
    variables: Record<string, unknown>,
    state: MutableExecutionState,
    evaluation: Record<string, unknown>,
  ): void {
    const executed: string[] = [];
    for (const reference of [...node.actions].sort((a, b) => a.order - b.order)) {
      const action = compiled.actions[reference.code];
      if (!action)
        throw new DomainException('RUNTIME_ACTION_NOT_FOUND', `Action ${reference.code} not found`);
      this.executeAction(action, compiled, variables, state);
      executed.push(action.code);
    }
    evaluation.actions = executed;
  }

  /**
   * Escribe una salida desde fuera de un nodo RESULT (acción SET_FIELD, score de un nodo
   * SCORE) respetando el contrato cuando lo hay.
   *
   * Un artefacto que declara contrato de salida espera que TODO lo que se publica pase por
   * él: si solo lo aplicáramos en los nodos RESULT, una acción podría publicar un campo no
   * declarado, o el tipo equivocado en uno declarado, y la respuesta saldría igualmente.
   * Los artefactos 1.0 —sin contrato declarado— conservan la escritura libre de siempre.
   *
   * @param requireDeclared `false` para los campos heredados que el motor publica siempre
   *   (`score`): ahí el contrato se valida si el campo está declarado, pero no declararlo
   *   no puede convertirse de golpe en un error para artefactos que ya funcionaban.
   */
  private publishOutput(
    compiled: CompiledDecisionArtifact,
    state: MutableExecutionState,
    code: string,
    value: unknown,
    requireDeclared = true,
  ): void {
    const contracts = this.outputContracts(compiled);
    const declared = contracts.some((contract) => contract.code === code);
    if (!contracts.length || (!declared && !requireDeclared)) {
      state.output[code] = value;
      return;
    }
    this.setOutputValue(compiled, state, code, value);
  }

  private executeAction(
    action: GraphActionSnapshot,
    compiled: CompiledDecisionArtifact,
    variables: Record<string, unknown>,
    state: MutableExecutionState,
  ): void {
    const context = this.context(variables, state);
    const payload = action.payload;
    switch (action.type.toUpperCase()) {
      case 'SET_OUTCOME':
        state.outcome = String(payload.outcome ?? 'NO_DECISION');
        break;
      case 'SET_SCORE':
        state.score = requireFiniteNumber(
          this.resolveActionValue(payload, context),
          action.code,
          'La acción SET_SCORE',
        );
        break;
      case 'ADD_SCORE':
        state.score =
          requireFiniteNumber(state.score ?? 0, action.code, 'La puntuación acumulada') +
          requireFiniteNumber(
            this.resolveActionValue(payload, context),
            action.code,
            'La acción ADD_SCORE',
          );
        break;
      case 'SET_LIMIT':
        state.limit = requireFiniteNumber(
          this.resolveActionValue(payload, context),
          action.code,
          'La acción SET_LIMIT',
        );
        break;
      case 'SET_RISK_BAND':
        state.riskBand = String(this.resolveActionValue(payload, context));
        break;
      case 'SET_FIELD': {
        const field = String(payload.field);
        this.publishOutput(compiled, state, field, this.resolveActionValue(payload, context));
        break;
      }
      case 'CREATE_MANUAL_REVIEW':
        state.outcome = 'MANUAL_REVIEW';
        state.manualReview = {
          queueCode: String(payload.queueCode ?? 'CREDIT_REVIEW'),
          priority: requireFiniteNumber(payload.priority ?? 100, action.code, 'La prioridad'),
          slaMinutes: requireFiniteNumber(
            payload.slaMinutes ?? 240,
            action.code,
            'El SLA en minutos',
          ),
          evidence: renderTemplate(
            (payload.evidence ?? {}) as Record<string, unknown>,
            context,
          ) as Record<string, unknown>,
        };
        break;
      case 'EMIT_REASON':
        break;
      default:
        throw new DomainException(
          'UNSUPPORTED_ACTION_TYPE',
          `Unsupported action type ${action.type}`,
        );
    }

    for (const reason of action.reasonCodes) {
      state.reasons.push({
        reasonCodeId: reason.id,
        sourceActionId: action.id,
        code: reason.code,
        category: reason.category,
        message: String(renderTemplate(reason.publicMessage, this.context(variables, state))),
        internalMessage: String(
          renderTemplate(reason.internalMessage, this.context(variables, state)),
        ),
        severity: reason.severity,
        adverseAction: reason.adverseAction,
        priority: reason.priority,
      });
    }
  }

  private selectEdge(
    edges: GraphEdgeSnapshot[],
    compiled: CompiledDecisionArtifact,
    variables: Record<string, unknown>,
    state: MutableExecutionState,
    evaluation: Record<string, unknown>,
  ): GraphEdgeSnapshot | undefined {
    const results: Record<string, boolean> = {};
    for (const edge of edges.filter((candidate) => !candidate.default)) {
      const passed = [...edge.conditions]
        .sort((a, b) => a.order - b.order)
        .every((reference) => {
          const condition = compiled.conditions[reference.code];
          if (!condition) return false;
          return Boolean(
            this.expressions.evaluate(condition.expression, this.context(variables, state)),
          );
        });
      results[edge.key] = passed;
      if (passed) {
        evaluation.edgeConditions = results;
        return edge;
      }
    }
    const fallback = edges.find((edge) => edge.default);
    if (fallback) results[fallback.key] = true;
    evaluation.edgeConditions = results;
    return fallback;
  }

  private resolveActionValue(
    payload: Record<string, unknown>,
    context: Record<string, unknown>,
  ): unknown {
    if ('valueExpression' in payload)
      return this.expressions.evaluate(payload.valueExpression, context);
    if ('value' in payload) return renderTemplate(payload.value, context);
    return undefined;
  }

  private context(
    variables: Record<string, unknown>,
    state: MutableExecutionState,
  ): Record<string, unknown> {
    return {
      ...variables,
      variables,
      decision: {
        outcome: state.outcome,
        score: state.score,
        riskBand: state.riskBand,
        limit: state.limit,
        output: state.output,
      },
      output: state.output,
      // Espacio de nombres propio: las intermedias nunca se mezclan con las variables
      // del contrato, así una expresión no puede leer `dti` creyendo que es una entrada.
      intermediate: state.intermediates.readableView(state.currentNodeKey),
    };
  }

  /**
   * Publica el ciclo de vida de las intermedias de esta ejecución (§12). Una intermedia
   * que se crea y nunca se consume suele ser lógica muerta: conviene poder medirlo.
   */
  private recordIntermediateLifecycle(state: MutableExecutionState): void {
    if (!state.intermediates.size) return;
    const entries = state.intermediates.snapshot();
    const created = entries.filter((entry) => entry.state !== 'NOT_AVAILABLE');
    const consumed = created.filter((entry) => entry.consumedByNodeKeys.length);
    this.metrics.recordIntermediateEvent('CREATED', created.length);
    this.metrics.recordIntermediateEvent('CONSUMED', consumed.length);
    this.metrics.recordIntermediateEvent('UNUSED', created.length - consumed.length);
  }

  /**
   * Ejecuta los campos calculados que el nodo invoca (§5.1) y deja cada resultado en su
   * destino declarado.
   *
   * La definición viaja EMBEBIDA en el artefacto compilado, así que no se consulta la
   * base de datos durante una decisión: la versión del campo quedó fijada al compilar y
   * la ejecución sigue siendo reproducible aunque el campo se deprecie después.
   */
  private async applyCalculatedFieldCalls(
    node: GraphNodeSnapshot,
    compiled: CompiledDecisionArtifact,
    variables: Record<string, unknown>,
    state: MutableExecutionState,
    evaluation: Record<string, unknown>,
  ): Promise<void> {
    const calls = node.calculatedFieldCalls ?? [];
    if (!calls.length) return;

    for (const call of calls) {
      const started = Date.now();
      try {
        const inputs = this.resolveCalculatedFieldInputs(call, variables, state);
        const result = await executeCalculatedField(
          this.toExecutableField(call),
          inputs,
          this.scripts,
        );
        this.storeCalculatedFieldResult(call, compiled, state, result.value);
        state.calculatedFieldCalls.push({
          nodeKey: node.key,
          callKey: call.callKey,
          fieldCode: call.fieldCode,
          versionNumber: call.versionNumber,
          target: `${call.target.kind.toLowerCase()}.${call.target.code}`,
          outcome: result.outcome,
          durationMs: result.durationMs,
          value: result.value,
        });
        this.metrics.recordCalculatedField(call.fieldCode, 'SUCCESS', result.durationMs);
      } catch (error) {
        const errorCode = error instanceof DomainException ? error.code : 'CALCULATED_FIELD_FAILED';
        state.calculatedFieldCalls.push({
          nodeKey: node.key,
          callKey: call.callKey,
          fieldCode: call.fieldCode,
          versionNumber: call.versionNumber,
          target: `${call.target.kind.toLowerCase()}.${call.target.code}`,
          outcome: 'ERROR',
          durationMs: Date.now() - started,
          errorCode,
        });
        this.metrics.recordCalculatedField(call.fieldCode, 'ERROR', Date.now() - started);
        throw error;
      }
    }
    evaluation.calculatedFields = calls.map((call) => call.fieldCode).sort();
  }

  /** Alimenta cada entrada del campo calculado desde el contexto del grafo. */
  private resolveCalculatedFieldInputs(
    call: CalculatedFieldCallSnapshot,
    variables: Record<string, unknown>,
    state: MutableExecutionState,
  ): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};
    for (const [inputId, entry] of Object.entries(call.inputMapping ?? {})) {
      if (entry.source === 'LITERAL') {
        inputs[inputId] = entry.value;
        continue;
      }
      if (entry.source === 'EXPRESSION') {
        inputs[inputId] = this.expressions.evaluate(
          entry.expression,
          this.context(variables, state),
        );
        continue;
      }
      const path =
        entry.source === 'INTERMEDIATE' ? `intermediate.${entry.path ?? ''}` : (entry.path ?? '');
      inputs[inputId] = this.expressions.evaluate({ var: path }, this.context(variables, state));
    }
    return inputs;
  }

  /** Guarda el resultado en la intermedia o en la salida declarada como destino. */
  private storeCalculatedFieldResult(
    call: CalculatedFieldCallSnapshot,
    compiled: CompiledDecisionArtifact,
    state: MutableExecutionState,
    value: unknown,
  ): void {
    if (call.target.kind === 'INTERMEDIATE') {
      // Pasa por el mismo ámbito que cualquier otra escritura, así que hereda las
      // comprobaciones de autorización, tipo y política de actualización de §2.3.
      state.intermediates.write(call.target.code, state.currentNodeKey, value);
      return;
    }
    this.setOutputValue(compiled, state, call.target.code, value);
  }

  private toExecutableField(call: CalculatedFieldCallSnapshot): ExecutableCalculatedField {
    return {
      fieldCode: call.fieldCode,
      versionNumber: call.versionNumber,
      implementationKind: call.definition.implementationKind,
      contract: call.definition.contract as ExecutableCalculatedField['contract'],
      operation: call.definition.operation as ExecutableCalculatedField['operation'],
      sourceCode: call.definition.sourceCode,
      libraryPackages: call.definition.libraryPackages ?? [],
      defaultValue: call.definition.defaultValue,
      timeoutMs: call.definition.timeoutMs,
    };
  }

  /** Aplica las escrituras de variables intermedias declaradas por el nodo (§2). */
  private applyIntermediateWrites(
    node: GraphNodeSnapshot,
    variables: Record<string, unknown>,
    state: MutableExecutionState,
    evaluation: Record<string, unknown>,
  ): void {
    const assignments = intermediateAssignmentsOf(node);
    if (!assignments.length) return;
    const written: string[] = [];
    for (const assignment of assignments) {
      const code = String(assignment.code ?? '');
      const source = String(assignment.source ?? 'LITERAL').toUpperCase();
      let value: unknown;
      if (source === 'EXPRESSION') {
        value = this.expressions.evaluate(
          assignment.expression ?? assignment.valueExpression,
          this.context(variables, state),
        );
      } else if (source === 'VARIABLE') {
        value = this.expressions.evaluate(
          { var: String(assignment.variablePath ?? assignment.path ?? '') },
          this.context(variables, state),
        );
      } else if (source === 'TEMPLATE') {
        value = renderTemplate(assignment.value, this.context(variables, state));
      } else {
        value = assignment.value;
      }
      state.intermediates.write(code, node.key, value);
      written.push(code);
    }
    evaluation.intermediatesWritten = written.sort();
  }

  /**
   * Estado de los valores que este nodo procesó (§3.1). Distingue explícitamente lo
   * recibido, lo intermedio y lo publicado: sin esa separación el editor mostraba
   * cualquier valor calculado como si fuera una salida pública del artefacto.
   */
  private nodeVariableState(
    node: GraphNodeSnapshot,
    compiled: CompiledDecisionArtifact,
    variables: Record<string, unknown>,
    state: MutableExecutionState,
    intermediatesBefore: ReturnType<IntermediateScope['snapshot']>,
    outcome: { durationUs: number; error?: { code: string; message: string } } = { durationUs: 0 },
  ): NonNullable<EngineExecutionResult['trace'][number]['variableState']> {
    const inputs = compiled.variables
      .filter((variable) => !String(variable.usageType ?? 'INPUT').startsWith('OUTPUT'))
      .map((variable) => ({
        code: variable.code,
        dataType: variable.dataType,
        state:
          variables[variable.code] === undefined ? ('NOT_AVAILABLE' as const) : ('VALID' as const),
        value: variable.sensitive ? null : variables[variable.code],
        sensitivityClass: variable.sensitivityClass ?? (variable.sensitive ? 'PII' : 'INTERNAL'),
        origin: variable.expectedOrigin ?? 'REQUEST',
      }));

    const outputs = compiled.variables
      .filter((variable) => String(variable.usageType ?? '').startsWith('OUTPUT'))
      .map((variable) => {
        const field = (compiled.outputContract ?? []).find(
          (candidate) => candidate.code === variable.code,
        );
        const produced = state.output[variable.code] !== undefined;
        return {
          code: variable.code,
          dataType: variable.dataType,
          state: produced ? ('COMPUTED' as const) : ('NOT_AVAILABLE' as const),
          value: sanitize(state.output[variable.code], field?.tracePolicy ?? 'FULL'),
          sensitivityClass: variable.sensitivityClass ?? (variable.sensitive ? 'PII' : 'INTERNAL'),
          // El contrato de salida dice quién produce el campo; sin él, solo sabemos que
          // lo escribió algún nodo.
          origin: field?.sourceKind ?? 'NODE',
        };
      });

    const before = new Map(intermediatesBefore.map((entry) => [entry.code, entry]));
    const after = state.intermediates.snapshot();
    return {
      nodeKey: node.key,
      status: outcome.error ? ('ERROR' as const) : ('COMPLETED' as const),
      durationUs: outcome.durationUs,
      errors: outcome.error ? [outcome.error] : [],
      // Una intermedia disponible que ningún nodo ha leído todavía suele ser lógica
      // muerta; se avisa aquí para que se vea en el nodo, no solo en una métrica.
      warnings: after
        .filter((entry) => entry.state !== 'NOT_AVAILABLE' && !entry.consumedByNodeKeys.length)
        .map((entry) => `La variable intermedia ${entry.code} aún no la ha consumido ningún nodo`),
      inputs,
      intermediatesBefore,
      intermediatesAfter: after,
      intermediatesCreated: after
        .filter(
          (entry) =>
            before.get(entry.code)?.state === 'NOT_AVAILABLE' && entry.state !== 'NOT_AVAILABLE',
        )
        .map((entry) => entry.code),
      intermediatesUpdated: after
        .filter(
          (entry) =>
            before.get(entry.code)?.state !== 'NOT_AVAILABLE' &&
            entry.writtenByNodeKey === node.key,
        )
        .map((entry) => entry.code),
      outputs,
    };
  }
}
