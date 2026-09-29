/**
 * Catalogue of versioned domain event types — the single source of truth.
 *
 * Producers publish these through the outbox and consumers subscribe by them, so a
 * divergent literal on either side silently severs the pipeline. Payload interfaces
 * document contract v1 (schemaVersion '1'); breaking a shape means bumping the
 * schemaVersion on the envelope, never mutating these in place.
 */
export const DecisionEventType = {
  VERSION_SUBMITTED_FOR_REVIEW: 'version.submitted_for_review',
  VERSION_CHANGES_REQUESTED: 'version.changes_requested',
  VERSION_APPROVED: 'version.approved',
  VERSION_REJECTED: 'version.rejected',
  VERSION_PUBLISHED: 'version.published',
  SECURITY_RISK_DETECTED: 'security.risk_detected',
  /**
   * El motor tiene que avisar a AtlasBackend de una resolución humana (revisión manual de
   * identidad, riesgo o crédito; revisión de un extracto). No es una notificación de bandeja:
   * lo consume `AtlasCallbackDispatcher`, que hace la llamada HTTP y la reintenta.
   */
  ATLAS_CALLBACK_REQUESTED: 'atlas.callback_requested',
  /**
   * La vigilancia continua midió una versión desplegada en producción FUERA de su umbral
   * (`MonitoringEvaluatorService`, veredicto `BREACH`). Lo consume el proyector de
   * notificaciones, que avisa a riesgo y a cumplimiento. El literal es el que el evaluador ya
   * escribía en el outbox antes de entrar en este catálogo: cambiarlo dejaría sin proyectar las
   * filas pendientes que lo llevan.
   */
  MONITORING_BREACH_DETECTED: 'MONITORING_BREACH_DETECTED',
} as const;

export type DecisionEventType = (typeof DecisionEventType)[keyof typeof DecisionEventType];

/** v1 payload of {@link DecisionEventType.VERSION_SUBMITTED_FOR_REVIEW}. */
export interface VersionSubmittedForReviewPayload {
  versionId: string;
  approvalRequestId: string;
  artifactCode: string;
  versionNumber: number;
  workflowCode: string;
  /** Version author (createdBy) — the principal review outcomes notify back to. */
  authorId: string;
  /** Roles required by the approval steps, in step order. */
  reviewerRoles: string[];
}

/** v1 payload shared by changes_requested / approved / rejected. */
export interface VersionReviewOutcomePayload {
  versionId: string;
  approvalRequestId: string;
  artifactCode: string;
  versionNumber: number;
  authorId: string;
  decidedBy: string;
  comments: string | null;
}

/** v1 payload of {@link DecisionEventType.VERSION_PUBLISHED}. */
export interface VersionPublishedPayload {
  versionId: string;
  artifactCode: string;
  versionNumber: number;
  deploymentId: string;
  environmentCode: string;
}

/** v1 payload of {@link DecisionEventType.SECURITY_RISK_DETECTED}. */
export interface SecurityRiskDetectedPayload {
  versionId: string;
  artifactCode: string;
  versionNumber: number;
  approvalRequestId: string;
  severity: string;
  /** Human-readable line the notification shows; never carries the reviewed source code. */
  summary: string;
  findingCodes: string[];
}

/**
 * v1 payload of {@link DecisionEventType.ATLAS_CALLBACK_REQUESTED}.
 *
 * `route` es la ruta de AtlasBackend (sin base: la base es configuración del despliegue, no un
 * dato del evento) y `body` el cuerpo JSON tal cual se envía. Sólo valores planos: el cuerpo lo
 * lee otro servicio y viaja también a la auditoría si el aviso falla.
 */
export interface AtlasCallbackRequestedPayload {
  route: string;
  body: Record<string, string | null>;
}

/**
 * v1 payload of {@link DecisionEventType.MONITORING_BREACH_DETECTED}.
 *
 * El `aggregateId` del sobre es la versión de artefacto medida. `scope` es la variable (PSI), el
 * `atributo:grupo` (impacto adverso) o `-` cuando la medida es de la versión entera.
 */
export interface MonitoringBreachDetectedPayload {
  artifactCode: string;
  /** Código de `monitoring-thresholds.ts` (`PSI`, `ADVERSE_IMPACT_RATIO`, `AUC`…). */
  metricCode: string;
  scope: string;
  value: number;
  threshold: number;
  sampleSize: number;
}
