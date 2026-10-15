import { renderTemplate } from '../template-reference';
import { requireFiniteNumber } from './execution-state';
import type { EngineExecutionResult } from '../graph.types';

/**
 * La petición de revisión manual que declara un nodo `MANUAL_REVIEW` o una acción
 * `CREATE_MANUAL_REVIEW`: cola, prioridad, plazo y la evidencia ya renderizada.
 *
 * `code` identifica al declarante (nodo o acción) en el mensaje si un número no es finito.
 */
export function manualReviewRequestOf(
  declaration: Record<string, unknown>,
  code: string,
  context: Record<string, unknown>,
): NonNullable<EngineExecutionResult['manualReview']> {
  return {
    queueCode: String(declaration.queueCode ?? 'CREDIT_REVIEW'),
    priority: requireFiniteNumber(declaration.priority ?? 100, code, 'La prioridad'),
    slaMinutes: requireFiniteNumber(declaration.slaMinutes ?? 240, code, 'El SLA en minutos'),
    evidence: renderTemplate(
      (declaration.evidence ?? {}) as Record<string, unknown>,
      context,
    ) as Record<string, unknown>,
  };
}
