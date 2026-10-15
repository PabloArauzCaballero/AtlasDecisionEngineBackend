import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { WorkerRunStatus } from '@prisma/client';
import { AuditService } from '../../../../common/audit/audit.service';
import { DomainException } from '../../../../common/errors/domain-exception';
import { JobName } from '../../../../common/jobs/job-names';
import { JobSignalService } from '../../../../common/jobs/job-signal.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../../../common/security/security.types';
import { IdentityReviewAssignment } from './identity-review-assignment.service';
import type { IdentityReviewResolvedDto, ResolveIdentityReviewDto } from './identity-review.dto';
import { IdentityVerdictSigner } from './identity-verdict-signer.service';

@Injectable()
export class IdentityReviewResolutionService {
  private readonly logger = new Logger(IdentityReviewResolutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobSignal: JobSignalService,
    private readonly assignment: IdentityReviewAssignment,
    private readonly verdicts: IdentityVerdictSigner,
  ) {}

  /**
   * Cierra un caso con la decisión de quien arbitra.
   *
   * Las dos salidas hacen cosas muy distintas y conviene no confundirlas:
   *
   * - **Confirmar** devuelve la ejecución a `QUEUED` con el tipo de documento ya
   *   decidido. El worker la retoma desde el principio y esta vez la puerta no
   *   pregunta: la respuesta ya está dada. Las imágenes siguen ahí porque el
   *   caso nunca se cerró, que es exactamente la razón por la que un pendiente
   *   no las borra.
   * - **Rechazar** cierra en `DOCUMENT_REJECTED` con su motivo y borra las
   *   imágenes, igual que cualquier otro final: la regla de privacidad del
   *   módulo vuelve a aplicar en cuanto hay veredicto.
   *
   * Sólo quien lo reclamó puede cerrarlo. Sin esa segregación, «reclamar» es un
   * botón decorativo y cualquiera con el rol cierra cualquier caso de un tirón.
   *
   * **No avisa a AtlasBackend, y no es un olvido.** En esta bandeja sólo hay
   * ejecuciones del worker pedidas por HTTP (`POST …/identity-verification/runs`:
   * el portal del motor, las pruebas, el corpus), y AtlasBackend no crea ninguna:
   * la verificación del cliente entra por la decisión (`/v1/decisions/…`), cuyo
   * nodo WORKER llama al núcleo sin crear fila aquí, y su duda abre un caso en la
   * cola `IDENTIDAD` de `/v1/manual-reviews`. Ése es el que vuelve a Atlas, por el
   * outbox (`AtlasCallbackService`). Una ejecución de esta tabla no tiene
   * `executionId` ni cliente de Atlas al que avisar: inventarle un destino llenaría
   * la auditoría de avisos fallidos sin cerrar nada.
   */
  async resolve(
    tenantId: bigint,
    requestId: string,
    dto: ResolveIdentityReviewDto,
    principal: AuthenticatedPrincipal,
  ): Promise<IdentityReviewResolvedDto> {
    if (dto.action === 'CONFIRM_DOCUMENT' && dto.documentType === undefined) {
      throw new DomainException(
        'IDENTITY_REVIEW_DOCUMENT_TYPE_REQUIRED',
        'Confirmar el documento exige declarar cuál es: sin tipo no hay analizador y el caso volvería a la misma cola.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (dto.action === 'REJECT_DOCUMENT' && dto.rejectionReason === undefined) {
      throw new DomainException(
        'IDENTITY_REJECTION_REASON_REQUIRED',
        'Rechazar un documento exige declarar el motivo: un rechazo sin motivo no es medible.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const actual = await this.assignment.asignadoA(tenantId, requestId, principal);
    const esVeredicto = dto.action === 'CONFIRM_IDENTITY' || dto.action === 'DENY_IDENTITY';

    /*
     * Las dos familias de acción no se mezclan, y la invariante que las separa es observable: un
     * caso que llegó por la PUERTA todavía no tiene veredicto, y uno que llegó por el VEREDICTO ya
     * lo tiene. Sin este corte, firmar «es la misma persona» sobre un caso al que nadie ha mirado
     * la cara todavía produciría una etiqueta que no mide nada —y el corpus se construye con
     * exactamente estas etiquetas—.
     */
    if (esVeredicto && actual.decision === null) {
      throw new DomainException(
        'IDENTITY_REVIEW_NO_VERDICT_YET',
        'Este caso llegó a la cola porque no se supo qué documento era: todavía no hay veredicto que confirmar ni negar. Resuélvelo con CONFIRM_DOCUMENT o REJECT_DOCUMENT.',
        HttpStatus.CONFLICT,
      );
    }
    if (!esVeredicto && actual.decision !== null) {
      throw new DomainException(
        'IDENTITY_REVIEW_ALREADY_HAS_VERDICT',
        'Este caso ya tiene veredicto del worker y espera que una persona lo firme: resuélvelo con CONFIRM_IDENTITY o DENY_IDENTITY.',
        HttpStatus.CONFLICT,
      );
    }

    if (esVeredicto) {
      return this.verdicts.sign(tenantId, requestId, dto, principal, actual);
    }

    const confirma = dto.action === 'CONFIRM_DOCUMENT';

    await this.prisma.$transaction(async (tx) => {
      await this.assignment.cerrarSiSigueAsignado(
        tx,
        tenantId,
        requestId,
        principal,
        confirma
          ? {
              status: WorkerRunStatus.QUEUED,
              // El tipo que decidió la persona ES la respuesta: el worker lo lee
              // al retomar y se salta la puerta con él.
              documentType: dto.documentType,
              reviewResolvedBy: principal.id,
              reviewResolvedAt: new Date(),
              reviewNotes: dto.notes,
              // Se limpia el lease y el progreso; el motivo por el que ENTRÓ en
              // la cola se conserva, porque es lo que permite medir meses después
              // qué clase de duda se resolvió cómo.
              progress: 0,
              startedAt: null,
              leaseExpiresAt: null,
              errorCode: null,
              errorMessage: null,
            }
          : {
              status: WorkerRunStatus.DOCUMENT_REJECTED,
              rejectionReason: dto.rejectionReason,
              reviewResolvedBy: principal.id,
              reviewResolvedAt: new Date(),
              reviewNotes: dto.notes,
              finishedAt: new Date(),
              leaseExpiresAt: null,
              documentBytes: null,
              documentBackBytes: null,
              selfieBytes: null,
            },
      );
      await this.audit.append(
        {
          tenantId,
          eventType: 'IDENTITY_REVIEW_RESOLVED',
          aggregateType: 'IdentityVerificationRun',
          aggregateId: requestId,
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            action: dto.action,
            reviewReason: actual.reviewReason,
            documentType: dto.documentType ?? null,
            rejectionReason: dto.rejectionReason ?? null,
            arbitrationMode: actual.arbitrationMode,
          },
        },
        tx,
      );
    });

    if (confirma) {
      // Despertar al worker en vez de esperar a su siguiente sondeo: quien está
      // delante del móvil ya lleva minutos esperando por definición.
      // `notifyDetached` y no `notify`: el commit ya ocurrió, y un aviso perdido
      // sólo cuesta un sondeo de retraso — nunca debe tumbar la resolución.
      this.jobSignal.notifyDetached(JobName.IdentityVerification);
    }
    this.logger.log(`Arbitraje de ${requestId} resuelto por ${principal.id} como ${dto.action}.`);
    return {
      requestId,
      status: confirma ? WorkerRunStatus.QUEUED : WorkerRunStatus.DOCUMENT_REJECTED,
      resolvedBy: principal.id,
    };
  }
}
