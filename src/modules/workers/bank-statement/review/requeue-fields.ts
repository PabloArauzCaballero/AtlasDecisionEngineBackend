import { Prisma, WorkerRunStatus } from '@prisma/client';
import type { AuthenticatedPrincipal } from '../../../../common/security/security.types';

/**
 * Lo que se escribe en una ejecución que vuelve a la cola del worker para analizarse otra vez. Lo
 * comparten el reproceso de un caso en revisión y el de una ejecución cerrada sin resultado.
 *
 * El expediente vuelve a cero —una fila en cola con motivo de revisión describe un caso que ya no existe,
 * y la base lo rechaza—, los intentos se reponen —los gastados fueron contra el análisis anterior— y el
 * análisis provisional se borra, porque el que va a salir es otro. La entidad asignada, si la hay, queda
 * con quién y cuándo.
 */
export function requeueFields(
  principal: AuthenticatedPrincipal,
  assignedInstitutionCode?: string,
): Prisma.BankStatementRunUpdateInput {
  return {
    status: WorkerRunStatus.QUEUED,
    progress: 0,
    reviewReason: null,
    rejectionReason: null,
    reviewPriority: null,
    reviewOpenedAt: null,
    reviewClaimedBy: null,
    reviewClaimedAt: null,
    errorCode: null,
    errorMessage: null,
    // La resolución de una ejecución cerrada que se reanaliza ya no describe el análisis que va a salir;
    // queda en la auditoría.
    reviewResolvedBy: null,
    reviewResolvedAt: null,
    reviewNotes: null,
    institutionId: null,
    transactionCount: null,
    attemptCount: 0,
    leaseExpiresAt: null,
    queuedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    provisionalResultJson: Prisma.DbNull,
    // El titular se vuelve a leer y a comparar; el EXIGIDO se conserva.
    holderNameRead: null,
    holderVerdict: null,
    ...(assignedInstitutionCode
      ? {
          assignedInstitutionCode,
          assignedInstitutionBy: principal.id,
          assignedInstitutionAt: new Date(),
        }
      : {}),
  };
}
