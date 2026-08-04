import type { Attributes } from '@opentelemetry/api';
import { APP_ATTRIBUTES, SEMANTIC_ATTRIBUTES } from '../observability/telemetry.constants';
import type {
  AnalysisTier,
  DecisionStatus,
  SemanticAnalysisRequest,
} from '../domain/semantic-analysis.types';

const MODULE = 'semantic';

/**
 * Construcción de los atributos de los spans del pipeline.
 *
 * Vive fuera del pipeline para que éste describa el flujo de negocio y no la forma de la telemetría,
 * y para que la lista de lo que se emite pueda revisarse de un vistazo cuando toque auditar la
 * política de privacidad.
 *
 * Ninguna función de este archivo recibe el texto analizado ni ningún derivado suyo: sólo
 * identificadores generados por el sistema, recuentos y desenlaces de cardinalidad acotada. Ver
 * `docs/observability/04-data-privacy-policy.md`.
 */

/**
 * `exactOptionalPropertyTypes` impide asignar `undefined`, así que el tenant se omite cuando no
 * existe en lugar de emitirse vacío.
 */
function tenantOf(request: SemanticAnalysisRequest): Attributes {
  return request.tenantId === undefined ? {} : { [APP_ATTRIBUTES.tenantId]: request.tenantId };
}

export function analyzeAttributes(
  request: SemanticAnalysisRequest,
  retrievalMode: string,
): Attributes {
  return {
    [APP_ATTRIBUTES.module]: MODULE,
    [APP_ATTRIBUTES.operation]: 'analyze',
    [APP_ATTRIBUTES.entityType]: 'semantic-request',
    // `requestId` es un UUID del sistema, sin significado externo; `idempotencyKey`, en cambio, es
    // un identificador de negocio del cliente y nunca se emite.
    [APP_ATTRIBUTES.entityId]: request.requestId,
    [SEMANTIC_ATTRIBUTES.retrievalMode]: retrievalMode,
    ...tenantOf(request),
  };
}

export function retrieveAttributes(retrievalMode: string, categoryCount: number): Attributes {
  return {
    [APP_ATTRIBUTES.module]: MODULE,
    [APP_ATTRIBUTES.operation]: 'retrieve',
    [SEMANTIC_ATTRIBUTES.retrievalMode]: retrievalMode,
    [SEMANTIC_ATTRIBUTES.catalogCategoryCount]: categoryCount,
  };
}

export function classifyAttributes(tier: AnalysisTier, candidateCount: number): Attributes {
  return {
    [APP_ATTRIBUTES.module]: MODULE,
    [APP_ATTRIBUTES.operation]: 'classify',
    [SEMANTIC_ATTRIBUTES.tier]: tier,
    [SEMANTIC_ATTRIBUTES.candidateCount]: candidateCount,
  };
}

/** Desenlace del análisis: los atributos por los que se filtra en Jaeger. */
export function outcomeAttributes(outcome: {
  readonly status: DecisionStatus;
  readonly tier: AnalysisTier;
  readonly escalated: boolean;
  readonly model: string;
  readonly candidateCount: number;
}): Attributes {
  return {
    [SEMANTIC_ATTRIBUTES.status]: outcome.status,
    [SEMANTIC_ATTRIBUTES.tier]: outcome.tier,
    [SEMANTIC_ATTRIBUTES.escalated]: outcome.escalated,
    [SEMANTIC_ATTRIBUTES.model]: outcome.model,
    [SEMANTIC_ATTRIBUTES.candidateCount]: outcome.candidateCount,
  };
}
