import { Injectable, Logger } from '@nestjs/common';
import { WorkerRunStatus } from '@prisma/client';
import { AuditService } from '../../../../common/audit/audit.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../../../common/security/security.types';
import { IdentityReviewAssignment } from './identity-review-assignment.service';
import type { IdentityReviewResolvedDto, ResolveIdentityReviewDto } from './identity-review.dto';
import type { QueueRow } from './identity-review.queue';

@Injectable()
export class IdentityVerdictSigner {
  private readonly logger = new Logger(IdentityVerdictSigner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assignment: IdentityReviewAssignment,
  ) {}

  /**
   * Lo que firma una persona sobre la IDENTIDAD, que es la etiqueta del corpus.
   *
   * Se escribe en `humanDecision` y no encima de `decision`: pisarlo perdería la única comparación
   * que mide si el worker acierta —su veredicto contra el de la persona— y con ella la posibilidad
   * de calibrar sus umbrales contra algo que no sea él mismo. Las dos columnas juntas son, caso a
   * caso, una fila del corpus: lo que el motor dijo, lo que dijo la persona y con qué parecido.
   *
   * El caso sale de la cola y no vuelve al worker: aquí no falta ningún análisis, faltaba una
   * firma.
   */
  async sign(
    tenantId: bigint,
    requestId: string,
    dto: ResolveIdentityReviewDto,
    principal: AuthenticatedPrincipal,
    actual: QueueRow,
  ): Promise<IdentityReviewResolvedDto> {
    const confirma = dto.action === 'CONFIRM_IDENTITY';
    const humanDecision = confirma ? 'VERIFIED' : 'NOT_VERIFIED';
    const status = confirma ? WorkerRunStatus.SUCCEEDED : WorkerRunStatus.SUCCEEDED_WITH_WARNINGS;

    await this.prisma.$transaction(async (tx) => {
      await this.assignment.cerrarSiSigueAsignado(tx, tenantId, requestId, principal, {
        status,
        humanDecision,
        // Sólo si viene: un sujeto sin declarar deja la fila sin agrupar, y el exportador del
        // corpus lo CUENTA y lo dice, en vez de inventarse que cada caso es una persona distinta.
        ...(dto.subjectKey ? { subjectKey: dto.subjectKey } : {}),
        reviewResolvedBy: principal.id,
        reviewResolvedAt: new Date(),
        reviewNotes: dto.notes,
        finishedAt: new Date(),
        leaseExpiresAt: null,
        // El motivo por el que ENTRÓ se conserva: es lo que permite medir meses después qué
        // clase de duda se resolvió cómo, y es la mitad de la lectura del corpus.
      });
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
            // Las dos, juntas y sin mezclar: es lo que hace auditable la discrepancia.
            workerDecision: actual.decision,
            humanDecision,
            // A número: `similarityScore` es un `Decimal` de Prisma, y el canonizador de la
            // cadena de auditoría rechaza cualquier valor con métodos («Unsupported canonical JSON
            // value: function»). Pasa desapercibido hasta que alguien firma el primer caso.
            similarityScore:
              actual.similarityScore === null ? null : Number(actual.similarityScore),
          },
        },
        tx,
      );
    });

    this.logger.log(
      `Veredicto de ${requestId} firmado por ${principal.id} como ${humanDecision} ` +
        `(el worker dijo ${actual.decision ?? 'nada'}).`,
    );
    return { requestId, status, resolvedBy: principal.id };
  }
}
