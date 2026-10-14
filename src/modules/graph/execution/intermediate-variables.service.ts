import { Injectable } from '@nestjs/common';
import { MetricsService } from '../../../common/observability/metrics.service';
import { ExpressionEvaluator } from '../expression-evaluator';
import type { GraphNodeSnapshot } from '../graph.types';
import { intermediateAssignmentsOf } from '../validators/graph-intermediate.validator';
import { assignmentValueOf } from './assignment-value';
import { evaluationContext, type MutableExecutionState, type NodeScope } from './execution-state';

/** Escribe las variables intermedias que declara un nodo y mide su ciclo de vida. */
@Injectable()
export class IntermediateVariablesService {
  constructor(
    private readonly expressions: ExpressionEvaluator,
    private readonly metrics: MetricsService,
  ) {}

  /** Aplica las escrituras de variables intermedias declaradas por el nodo (§2). */
  applyWrites(node: GraphNodeSnapshot, { variables, state, evaluation }: NodeScope): void {
    const assignments = intermediateAssignmentsOf(node);
    if (!assignments.length) return;
    const written: string[] = [];
    for (const assignment of assignments) {
      const code = String(assignment.code ?? '');
      const value = assignmentValueOf(
        this.expressions,
        assignment,
        evaluationContext(variables, state),
      );
      state.intermediates.write(code, node.key, value);
      written.push(code);
    }
    evaluation.intermediatesWritten = written.sort();
  }

  /**
   * Publica el ciclo de vida de las intermedias de esta ejecución (§12). Una intermedia
   * que se crea y nunca se consume suele ser lógica muerta: conviene poder medirlo.
   */
  recordLifecycle(state: MutableExecutionState): void {
    if (!state.intermediates.size) return;
    const entries = state.intermediates.snapshot();
    const created = entries.filter((entry) => entry.state !== 'NOT_AVAILABLE');
    const consumed = created.filter((entry) => entry.consumedByNodeKeys.length);
    this.metrics.recordIntermediateEvent('CREATED', created.length);
    this.metrics.recordIntermediateEvent('CONSUMED', consumed.length);
    this.metrics.recordIntermediateEvent('UNUSED', created.length - consumed.length);
  }
}
