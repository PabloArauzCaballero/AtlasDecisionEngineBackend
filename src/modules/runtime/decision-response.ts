import { ExecutionStatus } from '@prisma/client';
import type { ResolvedDeployment } from '../deployments/deployment-resolver.service';
import type { EngineExecutionResult } from '../graph/graph.types';
import type { GuardVerdict } from '../risk-governance/decision-guard.service';
import type { RoleViolation } from '../risk-governance/semantic-outputs';
import type {
  ResolvedVariableSnapshot,
  VariableResolutionResult,
} from '../variables/variable-resolution.service';
import type { DecisionRequest } from './decision-request';
import { manualReviewCaseCode } from './manual-review-case-code';

/**
 * Cuánto vale una decisión aprobada para conceder, si nadie lo configura.
 *
 * El motor no reserva exposición (lee los créditos ya registrados), así que dos decisiones
 * simultáneas del mismo solicitante pueden pasar las dos. Quien concede tiene que revalidar, y
 * una decisión que no caduca le permitiría conceder mañana con la exposición de hoy.
 */
export const DEFAULT_DECISION_VALIDITY_SECONDS = 259_200;

/** Hasta cuándo puede concederse una decisión tomada en `now`. */
export function decisionValidUntil(now: Date, configuredSeconds: unknown): Date {
  const configured = Number(configuredSeconds);
  const seconds =
    Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_DECISION_VALIDITY_SECONDS;
  return new Date(now.getTime() + seconds * 1_000);
}

export function artifactReference(artifactCode: string, deployment: ResolvedDeployment) {
  return {
    code: artifactCode,
    versionId: deployment.artifactVersionId.toString(),
    deploymentId: deployment.deploymentId.toString(),
    environment: deployment.environmentCode,
    checksum: deployment.compiledChecksum,
  };
}

/** Respuesta 422 cuando las variables de entrada faltan o no son válidas. */
export function missingVariablesBody(
  { dto, artifactCode }: DecisionRequest,
  deployment: ResolvedDeployment,
  executionId: bigint,
  errors: VariableResolutionResult['errors'],
): Record<string, unknown> {
  return {
    requestId: dto.requestId,
    executionId: executionId.toString(),
    status: 'NO_DECISION',
    outcome: 'NO_DECISION',
    reasonCodes: ['VARIABLE_MISSING_OR_INVALID'],
    errors,
    artifact: {
      code: artifactCode,
      versionId: deployment.artifactVersionId.toString(),
      deploymentId: deployment.deploymentId.toString(),
      checksum: deployment.compiledChecksum,
    },
  };
}

/**
 * Respuesta 422 cuando falta la base habilitante y la política manda a revisión: el core la
 * lee como revisión, nunca como aprobación ni como rechazo crediticio.
 */
export function enablingBasisReviewBody(
  { dto, artifactCode }: DecisionRequest,
  deployment: ResolvedDeployment,
  executionId: bigint,
  verdict: GuardVerdict,
): Record<string, unknown> {
  const failures = verdict.basis.failures;
  return {
    requestId: dto.requestId,
    correlationId: dto.correlationId,
    executionId: executionId.toString(),
    status: ExecutionStatus.NO_DECISION,
    outcome: ExecutionStatus.NO_DECISION,
    reasonCodes: [
      {
        code: 'ENABLING_BASIS_MISSING',
        category: 'COMPLIANCE',
        message:
          'Falta una base habilitante vigente para tratar los datos del solicitante con esta ' +
          'finalidad. No es una negativa de riesgo: la solicitud va a revision.',
        adverseAction: false,
      },
    ],
    errors: failures.map((failure) => ({
      code: `ENABLING_BASIS_${failure.reason}`,
      purpose: failure.purpose,
    })),
    enablingBasis: { policySource: verdict.basis.policy.source, failures },
    decisionValidUntil: null,
    artifact: artifactReference(artifactCode, deployment),
  };
}

/** Respuesta 422 cuando una salida económica del grafo está fuera de rango (defecto del artefacto). */
export function invalidEconomicOutputBody(
  { dto, artifactCode }: DecisionRequest,
  deployment: ResolvedDeployment,
  executionId: bigint,
  violations: RoleViolation[],
): Record<string, unknown> {
  return {
    requestId: dto.requestId,
    correlationId: dto.correlationId,
    executionId: executionId.toString(),
    status: ExecutionStatus.NO_DECISION,
    outcome: ExecutionStatus.NO_DECISION,
    reasonCodes: [
      {
        code: 'ECONOMIC_OUTPUT_INVALID',
        category: 'TECHNICAL',
        message:
          'La politica produjo una salida economica fuera de rango. Es un defecto del ' +
          'artefacto, no una negativa sobre el solicitante: la solicitud va a revision.',
        adverseAction: false,
      },
    ],
    errors: violations.map((violation) => ({
      code: violation.code,
      field: violation.fieldCode,
      message: violation.message,
    })),
    decisionValidUntil: null,
    artifact: artifactReference(artifactCode, deployment),
  };
}

/** Lo que `executedDecisionBody` necesita además de la petición y el resultado del motor. */
export interface ExecutedDecisionFacts {
  deployment: ResolvedDeployment;
  executionId: bigint;
  result: EngineExecutionResult;
  guard: GuardVerdict;
  snapshots: ResolvedVariableSnapshot[];
  /** Instante hasta el que quien concede puede fiarse de la decisión. */
  validUntil: Date;
}

/** Respuesta 200 de una decisión ejecutada (con o sin aprobación). */
export function executedDecisionBody(
  { dto, artifactCode }: DecisionRequest,
  facts: ExecutedDecisionFacts,
): Record<string, unknown> {
  const { deployment, executionId, result, guard, snapshots, validUntil } = facts;
  const succeeded = String(result.status) === ExecutionStatus.SUCCEEDED;
  return {
    requestId: dto.requestId,
    correlationId: dto.correlationId,
    executionId: executionId.toString(),
    status: result.status,
    outcome: result.outcome,
    score: result.score,
    riskBand: result.riskBand,
    limit: result.limit,
    output: result.output,
    primaryResult: result.primaryResult,
    reasonCodes: result.reasons.map((reason) => ({
      code: reason.code,
      category: reason.category,
      message: reason.message,
      adverseAction: reason.adverseAction,
      priority: reason.priority,
    })),
    artifact: artifactReference(artifactCode, deployment),
    /*
     * Si esta ejecucion abrio un caso de revision manual, y en que cola.
     *
     * Lo pide quien nos llama, no nosotros: AtlasBackend abria SU propio caso para el mismo
     * cliente cada vez que el desenlace no era un «sigue adelante», y su portal lo dejaba
     * resolver con otro formulario. Dos bandejas para la misma persona, dos bitacoras que no se
     * hablan y ninguna respuesta a «quien aprobo».
     *
     * Ahora Atlas delega en nosotros SOLO cuando aqui hay de verdad un caso que atender. Sin este
     * campo tendria que adivinarlo por el desenlace, y se equivocaria: un REJECT no abre caso, y
     * el analista acabaria en una ejecucion sin bandeja mientras la unica cola posible —la suya—
     * estaba cerrada por nosotros.
     *
     * `null` cuando el grafo no paso por un nodo de revision manual. El caso se crea en la misma
     * transaccion que la ejecucion (`ExecutionWriterService`), asi que anunciarlo aqui no puede
     * mentir: o estan los dos o no esta ninguno.
     */
    manualReview: result.manualReview
      ? {
          caseCode: manualReviewCaseCode(executionId),
          queueCode: result.manualReview.queueCode,
          priority: result.manualReview.priority,
        }
      : null,
    traceReference: executionId.toString(),
    /*
     * Lo que quien CONCEDE necesita para revalidar (campos aditivos, P-11).
     *
     * El motor decide y el core concede. El motor lee la exposicion de los creditos ya
     * registrados y NO reserva: `exposure` publica cuanto quedaba y cuanto queda si se concede
     * lo pedido, y `decisionValidUntil` pone fecha de caducidad a la decision. El core reserva
     * contra su libro de forma atomica y no concede despues de esa fecha ni por encima de
     * `exposure.remainingAfterDecision`. Nulo cuando la decision no termino en SUCCEEDED.
     */
    decisionValidUntil: succeeded ? validUntil.toISOString() : null,
    exposure: guard.exposure,
    enablingBasis: {
      policySource: guard.basis.policy.source,
      purposes: guard.basis.policy.requirements.map((requirement) => requirement.purpose),
    },
    /*
     * Frescura (P-10). `degradedInputs` = alguna variable entro vieja, con sello dudoso o con
     * frescura desconocida; `freshnessUnknown` = las CRITICAS cuya frescura no se pudo
     * comprobar. El core no debe originar con datos criticos desconocidos.
     */
    degradedInputs: snapshots.some((snapshot) => snapshot.freshness?.degraded),
    freshnessUnknown: snapshots
      .filter((snapshot) => snapshot.freshness?.unknown)
      .map((snapshot) => snapshot.code),
  };
}
