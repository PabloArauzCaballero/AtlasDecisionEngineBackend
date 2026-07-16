import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain-exception';
import { ExpressionEvaluator } from './expression-evaluator';
import { renderTemplate } from './template-reference';
import { ScriptNodeRunnerService, type ScriptLanguage } from './script-node-runner.service';
import type {
  CompiledDecisionArtifact,
  DecisionReasonResult,
  EngineExecutionResult,
  GraphActionSnapshot,
  GraphEdgeSnapshot,
  GraphNodeSnapshot,
} from './graph.types';

interface MutableExecutionState {
  outcome: string;
  score?: number;
  riskBand?: string;
  limit?: number;
  output: Record<string, unknown>;
  reasons: DecisionReasonResult[];
  primaryResult?: EngineExecutionResult['primaryResult'];
  manualReview?: EngineExecutionResult['manualReview'];
}

@Injectable()
export class ExecutionEngineService {
  private readonly maxSteps: number;

  constructor(
    private readonly expressions: ExpressionEvaluator,
    config: ConfigService,
    private readonly scripts: ScriptNodeRunnerService,
  ) {
    this.maxSteps = config.get<number>('MAX_EXECUTION_STEPS') ?? 256;
  }

  async execute(
    compiled: CompiledDecisionArtifact,
    variables: Record<string, unknown>,
  ): Promise<EngineExecutionResult> {
    const state: MutableExecutionState = { outcome: 'NO_DECISION', output: {} , reasons: [] };
    const trace: EngineExecutionResult['trace'] = [];
    const visitedNodeKeys: string[] = [];
    const traversedEdgeKeys: string[] = [];
    let currentKey: string | undefined = compiled.startNodeKey;
    let terminalNodeKey: string | undefined;

    for (let stepIndex = 0; currentKey && stepIndex < this.maxSteps; stepIndex += 1) {
      const started = process.hrtime.bigint();
      const node = compiled.nodes[currentKey];
      if (!node) throw new DomainException('RUNTIME_NODE_NOT_FOUND', `Compiled node ${currentKey} not found`);
      visitedNodeKeys.push(node.key);
      const evaluation: Record<string, unknown> = {};

      if (node.type === 'SCORE') {
        this.evaluateScoreNode(node, compiled, variables, state, evaluation);
      }
      if (node.type === 'ACTION') {
        this.executeActions(node, compiled, variables, state, evaluation);
      }
      if (node.type === 'RESULT') {
        await this.evaluateResultNode(node, compiled, variables, state, evaluation);
      }
      if (node.type === 'MANUAL_REVIEW') {
        state.outcome = 'MANUAL_REVIEW';
        state.manualReview = {
          queueCode: String(node.config.queueCode ?? 'CREDIT_REVIEW'),
          priority: Number(node.config.priority ?? 100),
          slaMinutes: Number(node.config.slaMinutes ?? 240),
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

      const terminalByAction = node.actions.some((reference) => compiled.actions[reference.code]?.terminal);
      if (node.terminal || node.type === 'END' || node.type === 'RESULT' || node.type === 'MANUAL_REVIEW' || terminalByAction) {
        terminalNodeKey = node.key;
        trace.push({
          nodeId: node.id,
          nodeKey: node.key,
          nodeType: node.type,
          evaluation,
          durationUs: Number((process.hrtime.bigint() - started) / 1000n),
        });
        currentKey = undefined;
        break;
      }

      const selected = this.selectEdge(compiled.edgesByNode[node.key] ?? [], compiled, variables, state, evaluation);
      if (!selected) {
        throw new DomainException('NO_MATCHING_EDGE', `No outgoing edge matched node ${node.key}`);
      }
      traversedEdgeKeys.push(selected.key);
      trace.push({
        nodeId: node.id,
        nodeKey: node.key,
        nodeType: node.type,
        branchTaken: selected.key,
        evaluation,
        durationUs: Number((process.hrtime.bigint() - started) / 1000n),
      });
      currentKey = selected.to;
    }

    if (currentKey) {
      throw new DomainException('MAX_EXECUTION_STEPS_EXCEEDED', `Execution exceeded ${this.maxSteps} steps`);
    }
    if (!terminalNodeKey) {
      throw new DomainException('EXECUTION_WITHOUT_TERMINAL', 'Execution ended without a terminal node');
    }

    this.finalizeOutputContract(compiled, state);

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
      reasons: [...state.reasons].sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code)),
      trace,
      visitedNodeKeys,
      traversedEdgeKeys,
      terminalNodeKey,
      manualReview: state.manualReview,
    };
  }

  private async evaluateResultNode(
    node: GraphNodeSnapshot,
    compiled: CompiledDecisionArtifact,
    variables: Record<string, unknown>,
    state: MutableExecutionState,
    evaluation: Record<string, unknown>,
  ): Promise<void> {
    const mode = String(node.config.mode ?? 'MAPPING').toUpperCase();
    const values: Record<string, unknown> = {};
    if (mode === 'SCRIPT') {
      const script = (node.config.script ?? {}) as Record<string, unknown>;
      const language = String(script.language ?? '').toUpperCase() as ScriptLanguage;
      if (language !== 'JAVASCRIPT' && language !== 'PYTHON') {
        throw new DomainException('RESULT_SCRIPT_LANGUAGE_INVALID', `Unsupported RESULT script language ${language}`);
      }
      Object.assign(
        values,
        await this.scripts.execute(language, String(script.source ?? ''), this.context(variables, state)),
      );
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
        throw new DomainException('PRIMARY_OUTPUT_TOO_LONG', `Primary output ${code} exceeds 80 characters`);
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

  private assertOutputType(code: string, dataType: string, value: unknown, nullable: boolean): void {
    if (value === null || value === undefined) {
      if (nullable) return;
      throw new DomainException('OUTPUT_TYPE_INVALID', `Output ${code} cannot be null`);
    }
    const type = dataType.toUpperCase();
    const valid =
      (['INTEGER', 'INT', 'NUMBER', 'DECIMAL', 'FLOAT'].includes(type) &&
        typeof value === 'number' && Number.isFinite(value) &&
        (!['INTEGER', 'INT'].includes(type) || Number.isInteger(value))) ||
      (['STRING', 'TEXT', 'ENUM', 'DATE', 'DATETIME'].includes(type) && typeof value === 'string') ||
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
    let score = Number(node.config.baseScore ?? state.score ?? 0);
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
        const points = Number(
          component.pointsExpression
            ? this.expressions.evaluate(component.pointsExpression, this.context(variables, state))
            : component.points ?? 0,
        );
        score += points;
        applied.push({ conditionCode, points });
      }
    }
    if (node.config.scoreExpression) {
      score = Number(this.expressions.evaluate(node.config.scoreExpression, this.context(variables, state)));
    }
    state.score = score;
    state.output.score = score;
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
      if (!action) throw new DomainException('RUNTIME_ACTION_NOT_FOUND', `Action ${reference.code} not found`);
      this.executeAction(action, variables, state);
      executed.push(action.code);
    }
    evaluation.actions = executed;
  }

  private executeAction(
    action: GraphActionSnapshot,
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
        state.score = Number(this.resolveActionValue(payload, context));
        break;
      case 'ADD_SCORE':
        state.score = Number(state.score ?? 0) + Number(this.resolveActionValue(payload, context));
        break;
      case 'SET_LIMIT':
        state.limit = Number(this.resolveActionValue(payload, context));
        break;
      case 'SET_RISK_BAND':
        state.riskBand = String(this.resolveActionValue(payload, context));
        break;
      case 'SET_FIELD': {
        const field = String(payload.field);
        state.output[field] = this.resolveActionValue(payload, context);
        break;
      }
      case 'CREATE_MANUAL_REVIEW':
        state.outcome = 'MANUAL_REVIEW';
        state.manualReview = {
          queueCode: String(payload.queueCode ?? 'CREDIT_REVIEW'),
          priority: Number(payload.priority ?? 100),
          slaMinutes: Number(payload.slaMinutes ?? 240),
          evidence: renderTemplate(
            (payload.evidence ?? {}) as Record<string, unknown>,
            context,
          ) as Record<string, unknown>,
        };
        break;
      case 'EMIT_REASON':
        break;
      default:
        throw new DomainException('UNSUPPORTED_ACTION_TYPE', `Unsupported action type ${action.type}`);
    }

    for (const reason of action.reasonCodes) {
      state.reasons.push({
        reasonCodeId: reason.id,
        sourceActionId: action.id,
        code: reason.code,
        category: reason.category,
        message: String(renderTemplate(reason.publicMessage, this.context(variables, state))),
        internalMessage: String(renderTemplate(reason.internalMessage, this.context(variables, state))),
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
          return Boolean(this.expressions.evaluate(condition.expression, this.context(variables, state)));
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

  private resolveActionValue(payload: Record<string, unknown>, context: Record<string, unknown>): unknown {
    if ('valueExpression' in payload) return this.expressions.evaluate(payload.valueExpression, context);
    if ('value' in payload) return renderTemplate(payload.value, context);
    return undefined;
  }

  private context(variables: Record<string, unknown>, state: MutableExecutionState): Record<string, unknown> {
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
    };
  }
}
