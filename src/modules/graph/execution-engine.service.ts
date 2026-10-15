/**
 * Deterministic graph interpreter. It enforces step/output contracts and emits explainable traces;
 * infrastructure resolution and persistence remain outside the engine.
 *
 * El motor recorre el grafo y delega cada tipo de nodo en su ejecutor (`./execution/`).
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain-exception';
import { ActionNodeExecutor } from './execution/action-node.executor';
import { CalculatedFieldExecutor } from './execution/calculated-field.executor';
import { EdgeSelector } from './execution/edge-selector';
import { executionResultOf } from './execution/execution-result';
import type { ExecutionRun } from './execution/step-trace';
import { recordFailedStep, recordStep } from './execution/step-trace';
import {
  evaluationContext,
  type NodeEvaluation,
  type NodeScope,
} from './execution/execution-state';
import { IntermediateVariablesService } from './execution/intermediate-variables.service';
import { manualReviewRequestOf } from './execution/manual-review-request';
import { OutputContractService } from './execution/output-contract.service';
import { ResultNodeExecutor } from './execution/result-node.executor';
import { ScoreNodeExecutor } from './execution/score-node.executor';
import { WorkerNodeExecutor } from './execution/worker-node.executor';
import { IntermediateScope } from './intermediate-scope';
import type {
  ArtifactReferenceResolver,
  CompiledDecisionArtifact,
  EngineExecutionResult,
  GraphEdgeSnapshot,
  GraphNodeSnapshot,
  LiveStepEvent,
  NestedReferenceCursor,
  WorkerServiceInvoker,
} from './graph.types';

@Injectable()
export class ExecutionEngineService {
  private readonly maxSteps: number;

  constructor(
    config: ConfigService,
    private readonly scoreNodes: ScoreNodeExecutor,
    private readonly actionNodes: ActionNodeExecutor,
    private readonly workerNodes: WorkerNodeExecutor,
    private readonly resultNodes: ResultNodeExecutor,
    private readonly edges: EdgeSelector,
    private readonly calculatedFields: CalculatedFieldExecutor,
    private readonly intermediates: IntermediateVariablesService,
    private readonly outputs: OutputContractService,
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
    const run: ExecutionRun = {
      compiled,
      variables,
      state: {
        outcome: 'NO_DECISION',
        output: {},
        reasons: [],
        intermediates: new IntermediateScope(compiled.intermediates ?? []),
        currentNodeKey: compiled.startNodeKey,
        calculatedFieldCalls: [],
        workerCalls: [],
      },
      trace: [],
      visitedNodeKeys: [],
      traversedEdgeKeys: [],
      nestedExecutions: [],
      cursor: nestedCursor ?? { sequence: { value: 0 }, parentSequence: null, depth: 1 },
      referenceResolver,
      workerInvoker,
      onStep,
    };

    let currentKey: string | undefined = compiled.startNodeKey;
    for (let stepIndex = 0; currentKey && stepIndex < this.maxSteps; stepIndex += 1) {
      currentKey = await this.walkNode(run, currentKey, stepIndex);
    }

    if (currentKey) {
      throw new DomainException(
        'MAX_EXECUTION_STEPS_EXCEEDED',
        `Execution exceeded ${this.maxSteps} steps`,
      );
    }
    if (!run.terminalNodeKey) {
      throw new DomainException(
        'EXECUTION_WITHOUT_TERMINAL',
        'Execution ended without a terminal node',
      );
    }

    this.outputs.finalizeOutputContract(compiled, run.state);
    this.intermediates.recordLifecycle(run.state);
    return executionResultOf(run, run.terminalNodeKey);
  }

  /** Ejecuta un nodo y devuelve la clave del siguiente, o `undefined` si la ejecución termina. */
  private async walkNode(
    run: ExecutionRun,
    nodeKey: string,
    stepIndex: number,
  ): Promise<string | undefined> {
    const { compiled, variables, state, onStep } = run;
    const started = process.hrtime.bigint();
    const node = compiled.nodes[nodeKey];
    if (!node)
      throw new DomainException('RUNTIME_NODE_NOT_FOUND', `Compiled node ${nodeKey} not found`);
    run.visitedNodeKeys.push(node.key);
    state.currentNodeKey = node.key;
    // Antes de ejecutar nada: toda intermedia que nazca en este nodo queda fechada en
    // ESTE paso, que es el mismo índice con el que la traza lo publica (§3.1).
    state.intermediates.enterStep(stepIndex);
    const evaluation: NodeEvaluation = {};
    const scope: NodeScope = { compiled, variables, state, evaluation };
    // Foto de las intermedias ANTES de ejecutar el nodo (§3.1: "variables
    // intermedias disponibles antes de la ejecución").
    const intermediatesBefore = state.intermediates.snapshot();
    onStep?.({ status: 'RUNNING', nodeKey: node.key, nodeType: node.type });
    const elapsedUs = () => Number((process.hrtime.bigint() - started) / 1000n);

    try {
      await this.runNodeLogic(run, node, scope);

      // Los campos calculados corren ANTES de las asignaciones de intermedias: una
      // asignación puede combinar el resultado de un campo con otros valores, pero un
      // campo nunca depende de una asignación posterior del mismo nodo.
      await this.calculatedFields.apply(node, scope);

      // Las escrituras de intermedias van DESPUÉS de la lógica del nodo: una
      // asignación puede depender del score o del output que el propio nodo acaba
      // de calcular.
      this.intermediates.applyWrites(node, scope);

      if (this.endsExecution(node, compiled)) {
        run.terminalNodeKey = node.key;
        const durationUs = elapsedUs();
        recordStep(run, { node, evaluation, intermediatesBefore, durationUs });
        onStep?.({ status: 'COMPLETED', nodeKey: node.key, nodeType: node.type, durationUs });
        return undefined;
      }

      const selected = this.edges.select(compiled.edgesByNode[node.key] ?? [], scope);
      if (!selected) {
        throw new DomainException('NO_MATCHING_EDGE', `No outgoing edge matched node ${node.key}`);
      }
      run.traversedEdgeKeys.push(selected.key);
      const durationUs = elapsedUs();
      recordStep(run, { node, evaluation, intermediatesBefore, durationUs }, selected.key);
      onStep?.({
        status: 'COMPLETED',
        nodeKey: node.key,
        nodeType: node.type,
        branchTaken: selected.key,
        // Every other outgoing edge, whether or not its condition was actually
        // evaluated (short-circuit evaluation in select() may skip some) —
        // for a "ramas descartadas" visualization the viewer wants every branch
        // not walked, not just the ones formally condition-checked.
        discardedEdgeKeys: this.discardedEdgeKeys(compiled, node, selected),
        durationUs,
      });
      return selected.to;
    } catch (error) {
      recordFailedStep(run, { node, evaluation, intermediatesBefore }, elapsedUs(), error);
      throw error;
    }
  }

  /** La lógica propia de cada tipo de nodo. */
  private async runNodeLogic(
    run: ExecutionRun,
    node: GraphNodeSnapshot,
    scope: NodeScope,
  ): Promise<void> {
    const { state } = scope;
    const nested = {
      referenceResolver: run.referenceResolver,
      cursor: run.cursor,
      nestedExecutions: run.nestedExecutions,
    };
    switch (node.type) {
      case 'SCORE':
        this.scoreNodes.execute(node, scope);
        return;
      case 'ACTION':
        this.actionNodes.execute(node, scope);
        return;
      case 'WORKER':
        await this.workerNodes.execute(node, scope, run.workerInvoker);
        return;
      case 'RESULT':
        await this.resultNodes.execute(node, scope, nested);
        return;
      case 'MANUAL_REVIEW':
        /*
         * Un nodo que TERMINA la ejecución tiene que poder escribir las salidas.
         *
         * El mapeo de salidas sólo se aplicaba en `RESULT`, así que un artefacto que
         * derivaba a una persona terminaba sin sus salidas obligatorias y el motor lo
         * rechazaba con `REQUIRED_OUTPUT_MISSING`: quien llamaba recibía un error, no
         * un «esto lo ve un humano». Encolar el caso y contestar al que llama son dos
         * cosas distintas y hacen falta las dos.
         *
         * Se reutiliza el ejecutor de `RESULT` en vez de duplicar el mapeo, y sólo cuando
         * el nodo declara `MAPPING`: un `MANUAL_REVIEW` sin salidas declaradas sigue
         * comportándose como antes.
         */
        if (node.config.mode === 'MAPPING') {
          await this.resultNodes.execute(node, scope, nested);
        }
        state.outcome = 'MANUAL_REVIEW';
        state.manualReview = manualReviewRequestOf(
          node.config,
          node.key,
          evaluationContext(scope.variables, state),
        );
        run.terminalNodeKey = node.key;
        return;
      case 'END':
        state.outcome = String(node.config.outcome ?? state.outcome);
        run.terminalNodeKey = node.key;
        return;
      default:
        return;
    }
  }

  private endsExecution(node: GraphNodeSnapshot, compiled: CompiledDecisionArtifact): boolean {
    const terminalByAction = node.actions.some(
      (reference) => compiled.actions[reference.code]?.terminal,
    );
    return (
      node.terminal ||
      node.type === 'END' ||
      node.type === 'RESULT' ||
      node.type === 'MANUAL_REVIEW' ||
      terminalByAction
    );
  }

  private discardedEdgeKeys(
    compiled: CompiledDecisionArtifact,
    node: GraphNodeSnapshot,
    selected: GraphEdgeSnapshot,
  ): string[] {
    return (compiled.edgesByNode[node.key] ?? [])
      .map((edge) => edge.key)
      .filter((key) => key !== selected.key);
  }
}
