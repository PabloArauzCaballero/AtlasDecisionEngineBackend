import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma, StatementRejectionReason, WorkerRunStatus } from '@prisma/client';
import { affordabilityColumns } from '../bank-statement-run-columns';
import type { NormalizedBankStatement } from '../core/engine/normalized/normalized-model';
import { AuditService } from '../../../../common/audit/audit.service';
import { DomainException } from '../../../../common/errors/domain-exception';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../../../common/security/security.types';
import { AtlasCallbackService } from '../../../atlas-callback/atlas-callback.service';
import { StatementReviewAssignment } from './statement-review-assignment.service';
import { QUEUE_SELECTION } from './statement-review.queue';
import type { ResolveStatementReviewDto } from './statement-review.dto';

/** A donde vuelve, en AtlasBackend, la resolución de una revisión de extracto. */
export const RUTA_DE_CALLBACK_DE_EXTRACTOS = '/internal/credit/bank-statement-review-callback';

@Injectable()
export class StatementReviewResolutionService {
  private readonly logger = new Logger(StatementReviewResolutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly callbacks: AtlasCallbackService,
    private readonly assignment: StatementReviewAssignment,
  ) {}

  /**
   * Cierra un caso con la decisión de una persona.
   *
   * Sólo quien lo reclamó puede cerrarlo, por la misma segregación que gobierna
   * la revisión manual de decisiones: sin ella, «reclamar» es un botón decorativo
   * y cualquiera con el rol cierra cualquier caso de un tirón.
   */
  async resolve(
    tenantId: bigint,
    requestId: string,
    dto: ResolveStatementReviewDto,
    principal: AuthenticatedPrincipal,
  ) {
    if (dto.action === 'MARK_INVALID' && !dto.rejectionReason) {
      throw new DomainException(
        'BANK_STATEMENT_REJECTION_REASON_REQUIRED',
        'Marcar un documento como no válido exige declarar el motivo.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const current = await this.assignment.assertAssignee(tenantId, requestId, principal);
    const outcome = resolutionOutcome(dto, current.transactionCount);

    await this.prisma.$transaction(async (tx) => {
      /*
       * Aprobar un caso que sólo tiene análisis PROVISIONAL (emisor no reconocido) lo convierte en el
       * resultado: es la firma de quien vio el PDF y los movimientos. Sin esto, la aprobación cerraba
       * el caso sin resultado y AtlasBackend lo leía como «sin capacidad utilizable» y lo rechazaba.
       * Rechazar o marcar no válido no promueve nada.
       */
      const promoted =
        dto.action === 'APPROVE' || dto.action === 'CORRECT'
          ? await this.provisionalToPromote(tx, tenantId, requestId)
          : null;
      await tx.bankStatementRun.update({
        where: { tenantId_requestId: { tenantId, requestId } },
        data: {
          status: outcome.status,
          rejectionReason: outcome.rejectionReason,
          // El motivo por el que ENTRÓ en la cola se conserva: es lo que permite
          // medir, meses después, qué clase de duda se resolvió cómo.
          reviewResolvedBy: principal.id,
          reviewResolvedAt: new Date(),
          reviewNotes: dto.notes,
          finishedAt: new Date(),
          // El caso se cierra: el documento deja de hacer falta, y la regla de
          // privacidad del módulo vuelve a aplicar.
          fileBytes: null,
          ...(promoted
            ? {
                resultJson: promoted as unknown as Prisma.InputJsonValue,
                institutionId: promoted.institution.id,
                transactionCount: promoted.transactions.length,
                ...affordabilityColumns(promoted),
              }
            : {}),
        },
      });
      /*
       * El extracto casi siempre lo subió AtlasBackend, y allí la revisión del cliente espera en
       * `processing` a que alguien la cierre: sin este aviso esperaba para siempre y le impedía
       * subir otro extracto (`409 BANK_STATEMENT_REVIEW_ALREADY_OPEN`). Se encola en la misma
       * transacción, como el de la revisión manual.
       *
       * El aviso lleva sólo la referencia y el desenlace: AtlasBackend vuelve a leer la ejecución
       * con su propia credencial y decide con lo que lee, no con lo que dice el aviso. Un extracto
       * que subió otro (el portal, una prueba) llega a Atlas sin revisión abierta y no hace nada.
       */
      await this.callbacks.solicitar(tx, {
        tenantId,
        ruta: RUTA_DE_CALLBACK_DE_EXTRACTOS,
        cuerpo: {
          requestId,
          status: outcome.status,
          action: dto.action,
          resolvedByInternalUserId: principal.id,
        },
        aggregateType: 'BankStatementRun',
        aggregateId: requestId,
        actorId: principal.id,
        correlationId: principal.requestId,
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'BANK_STATEMENT_REVIEW_RESOLVED',
          aggregateType: 'BankStatementRun',
          aggregateId: requestId,
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            action: dto.action,
            resolvedStatus: outcome.status,
            reviewReason: current.reviewReason,
            rejectionReason: outcome.rejectionReason,
            notes: dto.notes,
            ...(promoted ? { promotedProvisionalAnalysis: true } : {}),
          },
        },
        tx,
      );
    });
    this.logger.log(
      `Revisión de extracto resuelta: solicitud=${requestId} accion=${dto.action} ` +
        `estado=${outcome.status} motivoOriginal=${String(current.reviewReason)}`,
    );
    return this.prisma.bankStatementRun.findFirstOrThrow({
      where: { tenantId, requestId },
      select: { ...QUEUE_SELECTION, reviewNotes: true, rejectionReason: true },
    });
  }
  /** El provisional, si el caso no tiene resultado propio. Con resultado, aprobar no cambia nada. */
  private async provisionalToPromote(
    tx: Prisma.TransactionClient,
    tenantId: bigint,
    requestId: string,
  ): Promise<NormalizedBankStatement | null> {
    const row = await tx.bankStatementRun.findUnique({
      where: { tenantId_requestId: { tenantId, requestId } },
      select: { resultJson: true, provisionalResultJson: true },
    });
    if (!row || row.resultJson !== null || row.provisionalResultJson === null) return null;
    return row.provisionalResultJson as unknown as NormalizedBankStatement;
  }
}

/**
 * En qué estado queda un caso según lo que decidió la persona.
 *
 * `APPROVE` y `CORRECT` conservan la distinción entre «salió bien» y «salió con
 * advertencias» usando lo que de verdad hay: un caso aprobado sin ni un
 * movimiento extraído no puede publicarse como `SUCCEEDED`, porque quien lea la
 * métrica de éxito leería un acierto donde hubo una decisión humana sobre nada.
 */
function resolutionOutcome(
  dto: ResolveStatementReviewDto,
  transactionCount: number | null,
): { status: WorkerRunStatus; rejectionReason: StatementRejectionReason | null } {
  if (dto.action === 'MARK_INVALID') {
    return {
      status: WorkerRunStatus.PDF_INVALID,
      rejectionReason: dto.rejectionReason ?? StatementRejectionReason.NOT_BANK_STATEMENT,
    };
  }
  if (dto.action === 'REJECT') {
    return { status: WorkerRunStatus.FAILED, rejectionReason: null };
  }
  const conMovimientos = (transactionCount ?? 0) > 0;
  return {
    status:
      conMovimientos && dto.action === 'APPROVE'
        ? WorkerRunStatus.SUCCEEDED
        : WorkerRunStatus.SUCCEEDED_WITH_WARNINGS,
    rejectionReason: null,
  };
}
