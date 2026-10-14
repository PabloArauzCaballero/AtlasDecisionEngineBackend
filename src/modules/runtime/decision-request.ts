import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import type { ResolvedDeployment } from '../deployments/deployment-resolver.service';
import type { ExecuteDecisionDto } from './runtime.dto';
import type { SubjectPolicyOutcome } from './subject-policy';

/** HTTP status and serializable response produced by the decision runtime. */
export interface RuntimeHttpResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

/** Quién pide qué: lo que identifica una petición de decisión de principio a fin. */
export interface DecisionRequest {
  tenantId: bigint;
  artifactCode: string;
  dto: ExecuteDecisionDto;
  principal: AuthenticatedPrincipal;
}

/** Reserva de idempotencia vigente; `lease` es el comprobante de propiedad. */
export interface IdempotencyReservation {
  id: bigint;
  lease: Date;
}

/** Una petición ya admitida: despliegue resuelto, sujeto aplicado y reserva en mano. */
export interface AdmittedDecision {
  request: DecisionRequest;
  deployment: ResolvedDeployment;
  subject: SubjectPolicyOutcome;
  reservation: IdempotencyReservation;
  /** UN instante por petición (ver `DECISION_CLOCK`). */
  now: Date;
}
