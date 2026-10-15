import { Injectable } from '@nestjs/common';
import { DomainException } from '../../../common/errors/domain-exception';
import { ExpressionEvaluator } from '../expression-evaluator';
import type {
  CompiledDecisionArtifact,
  GraphActionSnapshot,
  GraphNodeSnapshot,
} from '../graph.types';
import { renderTemplate } from '../template-reference';
import {
  evaluationContext,
  requireFiniteNumber,
  type MutableExecutionState,
  type NodeScope,
} from './execution-state';
import { manualReviewRequestOf } from './manual-review-request';
import { OutputContractService } from './output-contract.service';

/** Ejecuta las acciones de un nodo `ACTION`, en el orden que el nodo declara. */
@Injectable()
export class ActionNodeExecutor {
  constructor(
    private readonly expressions: ExpressionEvaluator,
    private readonly outputs: OutputContractService,
  ) {}

  execute(node: GraphNodeSnapshot, { compiled, variables, state, evaluation }: NodeScope): void {
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

  private executeAction(
    action: GraphActionSnapshot,
    compiled: CompiledDecisionArtifact,
    variables: Record<string, unknown>,
    state: MutableExecutionState,
  ): void {
    const context = evaluationContext(variables, state);
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
        this.outputs.publishOutput(
          compiled,
          state,
          field,
          this.resolveActionValue(payload, context),
        );
        break;
      }
      case 'CREATE_MANUAL_REVIEW':
        state.outcome = 'MANUAL_REVIEW';
        state.manualReview = manualReviewRequestOf(payload, action.code, context);
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
        message: String(renderTemplate(reason.publicMessage, evaluationContext(variables, state))),
        internalMessage: String(
          renderTemplate(reason.internalMessage, evaluationContext(variables, state)),
        ),
        severity: reason.severity,
        adverseAction: reason.adverseAction,
        priority: reason.priority,
      });
    }
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
}
