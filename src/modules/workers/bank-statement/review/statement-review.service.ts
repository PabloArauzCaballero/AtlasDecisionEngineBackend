import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  StatementRejectionReason,
  StatementReviewReason,
  WorkerRunStatus,
} from '@prisma/client';
import { AuditService } from '../../../../common/audit/audit.service';
import { DomainException } from '../../../../common/errors/domain-exception';
import { JobName } from '../../../../common/jobs/job-names';
import { JobSignalService } from '../../../../common/jobs/job-signal.service';
import { pageResult, paginationArgs } from '../../../../common/http/pagination';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { consultaCrudaConTenant } from '../../../../common/prisma/tenant-scoped-raw';
import type { AuthenticatedPrincipal } from '../../../../common/security/security.types';
import { REVIEW_STATUSES } from '../statement-outcome';
import {
  type ResolveStatementReviewDto,
  type StatementReprocessedDto,
  type StatementReviewCategoryDto,
  type StatementReviewItemDto,
  type StatementReviewQueryDto,
} from './statement-review.dto';

/** Columnas que la cola necesita. `fileBytes` NUNCA sale de aquí. */
const QUEUE_SELECTION = {
  requestId: true,
  fileName: true,
  requestedBy: true,
  status: true,
  reviewReason: true,
  reviewPriority: true,
  reviewOpenedAt: true,
  reviewClaimedBy: true,
  reviewClaimedAt: true,
  errorCode: true,
  errorMessage: true,
  institutionId: true,
  confidence: true,
  documentTypeConfidence: true,
  transactionCount: true,
  queuedAt: true,
} satisfies Prisma.BankStatementRunSelect;

/**
 * La cola de revisión humana de extractos.
 *
 * Existe porque el motor tiene una franja en la que no debe decidir solo, y
 * porque esa franja **no** puede ser el vertedero de todo lo que no entendió: lo
 * que llega aquí ya pasó el triage (`statement-outcome.ts`) y es, por
 * construcción, razonablemente compatible con un extracto. Un `PDF_INVALID` no
 * entra —queda en el historial como rechazado— y ninguna consulta de este
 * servicio puede devolverlo, porque todas acotan por `REVIEW_STATUSES`.
 *
 * Todo se pagina y se filtra en el servidor. La lista crece con el volumen de
 * subidas y traérsela entera al navegador convertiría la pantalla en inservible
 * justo el día que hay trabajo que hacer.
 */
@Injectable()
export class StatementReviewService {
  private readonly logger = new Logger(StatementReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly jobSignal: JobSignalService,
  ) {}

  async list(tenantId: bigint, query: StatementReviewQueryDto) {
    const paging = paginationArgs(query, this.config.get<number>('MAX_PAGE_SIZE') ?? 100);
    const where = this.queueWhere(tenantId, query);
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.bankStatementRun.count({ where }),
      this.prisma.bankStatementRun.findMany({
        where,
        select: QUEUE_SELECTION,
        skip: paging.skip,
        take: paging.take,
        // Prioridad primero y antigüedad después: es el orden en que se trabaja
        // una cola, y el mismo que el índice `…_review_queue_idx` ya materializa.
        orderBy: [{ reviewPriority: 'asc' }, { reviewOpenedAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    const now = Date.now();
    return pageResult(
      rows.map((row) => this.toItem(row, now)),
      total,
      paging.page,
      paging.pageSize,
    );
  }

  /**
   * Los contadores de las pestañas, en UNA consulta agregada.
   *
   * Vienen del backend y no de contar la página cargada, que es la trampa
   * evidente: la página trae 25 filas y el rótulo diría «Timeout (4)» sobre una
   * cola de cuatrocientos. La fila «Todos» se suma aquí en vez de pedir un
   * agregado más.
   */
  async categories(tenantId: bigint): Promise<StatementReviewCategoryDto[]> {
    const rows = await this.prisma.bankStatementRun.groupBy({
      by: ['reviewReason'],
      where: { tenantId, status: { in: [...REVIEW_STATUSES] } },
      _count: { _all: true },
      _min: { reviewOpenedAt: true },
    });
    const claimed = await this.prisma.bankStatementRun.groupBy({
      by: ['reviewReason'],
      where: { tenantId, status: WorkerRunStatus.IN_REVIEW },
      _count: { _all: true },
    });
    const claimedBy = new Map(claimed.map((row) => [row.reviewReason, row._count._all]));

    const now = Date.now();
    const byCategory = rows
      .filter(
        (row): row is typeof row & { reviewReason: StatementReviewReason } =>
          row.reviewReason !== null,
      )
      .map((row) => ({
        category: row.reviewReason,
        total: row._count._all,
        claimed: claimedBy.get(row.reviewReason) ?? 0,
        oldestPendingMs: elapsed(row._min.reviewOpenedAt, now),
      }));

    const todos: StatementReviewCategoryDto = {
      category: null,
      total: byCategory.reduce((sum, row) => sum + row.total, 0),
      claimed: byCategory.reduce((sum, row) => sum + row.claimed, 0),
      oldestPendingMs: byCategory.reduce<number | null>(
        (oldest, row) =>
          row.oldestPendingMs === null ? oldest : Math.max(oldest ?? 0, row.oldestPendingMs),
        null,
      ),
    };
    // «Todos» primero, y el resto por volumen: la pestaña con más trabajo es la
    // que hay que ver sin buscarla.
    return [todos, ...byCategory.sort((a, b) => b.total - a.total)];
  }

  /** Un caso con todo lo que hace falta para decidirlo. */
  async get(tenantId: bigint, requestId: string) {
    const run = await this.prisma.bankStatementRun.findFirst({
      where: { tenantId, requestId, status: { in: [...REVIEW_STATUSES] } },
      select: {
        ...QUEUE_SELECTION,
        resultJson: true,
        warningsJson: true,
        fileSizeBytes: true,
        fileHash: true,
        correlationId: true,
        attemptCount: true,
        reviewNotes: true,
      },
    });
    if (!run) {
      // 404 y no 403 también aquí: un 403 confirmaría que el caso existe y es de
      // otro inquilino, que es justo lo que no debe poder averiguarse.
      throw new DomainException(
        'BANK_STATEMENT_REVIEW_NOT_FOUND',
        'No hay ningún caso de revisión con ese identificador.',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      ...this.toItem(run, Date.now()),
      result: run.resultJson,
      warnings: run.warningsJson,
      fileHash: run.fileHash,
      fileSizeBytes: run.fileSizeBytes,
      correlationId: run.correlationId,
      attemptCount: run.attemptCount,
      reviewNotes: run.reviewNotes,
      documentAvailable: await this.documentAvailable(tenantId, requestId),
    };
  }

  /**
   * ¿Sigue estando el PDF? Se pregunta con `octet_length` y no seleccionando la
   * columna: `fileBytes` pesa hasta 10 MiB y traerlo al proceso para mirar si su
   * longitud es cero convierte abrir un caso en transferir el documento entero.
   *
   * Consulta cruda dentro de transacción porque la tabla tiene RLS FORZADA; ver
   * `consultaCrudaConTenant`.
   */
  private async documentAvailable(tenantId: bigint, requestId: string): Promise<boolean> {
    const rows = await consultaCrudaConTenant(this.prisma, (tx) =>
      tx.$queryRaw<Array<{ tiene: boolean }>>(Prisma.sql`
        SELECT coalesce(octet_length(file_bytes), 0) > 0 AS tiene
        FROM decision_bank_statement_run
        WHERE tenant_id = ${tenantId} AND request_id = ${requestId}
      `),
    );
    return rows[0]?.tiene ?? false;
  }

  /**
   * Reclama un caso. Es el equivalente al `assign` de la revisión manual de
   * decisiones y existe por lo mismo: sin él, dos analistas gastan su tiempo en
   * el mismo documento y el segundo descubre que ya estaba resuelto al pulsar.
   *
   * `updateMany` con el estado en el `WHERE` y no `update`: es un reclamo, y un
   * reclamo que no es atómico no es un reclamo. Dos peticiones simultáneas pasan
   * las dos por un `findFirst` que ve el caso libre.
   */
  async claim(tenantId: bigint, requestId: string, principal: AuthenticatedPrincipal) {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.bankStatementRun.updateMany({
        where: { tenantId, requestId, status: WorkerRunStatus.PENDING_REVIEW },
        data: {
          status: WorkerRunStatus.IN_REVIEW,
          reviewClaimedBy: principal.id,
          reviewClaimedAt: new Date(),
        },
      });
      if (result.count === 0) return false;
      await this.audit.append(
        {
          tenantId,
          eventType: 'BANK_STATEMENT_REVIEW_CLAIMED',
          aggregateType: 'BankStatementRun',
          aggregateId: requestId,
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { requestId },
        },
        tx,
      );
      return true;
    });
    if (!claimed) {
      const current = await this.currentStatus(tenantId, requestId);
      throw new DomainException(
        'BANK_STATEMENT_REVIEW_NOT_CLAIMABLE',
        current === WorkerRunStatus.IN_REVIEW
          ? 'Otra persona ya está revisando este caso.'
          : 'Este caso ya no está esperando revisión.',
        HttpStatus.CONFLICT,
        { status: current },
      );
    }
    return this.get(tenantId, requestId);
  }

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
    const current = await this.assertAssignee(tenantId, requestId, principal);
    const outcome = resolutionOutcome(dto, current.transactionCount);

    await this.prisma.$transaction(async (tx) => {
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
        },
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

  /**
   * Devuelve el caso a la cola del worker para volver a intentarlo.
   *
   * Es la acción que da sentido a conservar el documento mientras el caso está
   * abierto: sin bytes no hay reproceso, y pedirle a quien subió el extracto que
   * vuelva a buscarlo en su disco para que el motor lo intente otra vez con los
   * umbrales ya corregidos es trasladarle el trabajo de arreglar el motor.
   */
  async reprocess(tenantId: bigint, requestId: string, principal: AuthenticatedPrincipal) {
    const current = await this.assertAssignee(tenantId, requestId, principal);
    if (!(await current.documentAvailable())) {
      throw new DomainException(
        'BANK_STATEMENT_DOCUMENT_UNAVAILABLE',
        'El documento original ya no está disponible: hay que volver a subirlo.',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.bankStatementRun.update({
        where: { tenantId_requestId: { tenantId, requestId } },
        data: {
          status: WorkerRunStatus.QUEUED,
          progress: 0,
          // El expediente entero vuelve a cero: una fila en cola que conserve el
          // motivo de revisión describe un caso que ya no existe, y la base lo
          // rechaza.
          reviewReason: null,
          rejectionReason: null,
          reviewPriority: null,
          reviewOpenedAt: null,
          reviewClaimedBy: null,
          reviewClaimedAt: null,
          errorCode: null,
          errorMessage: null,
          // Los intentos se reponen: los que gastó fueron contra la versión
          // anterior del análisis, y arrastrarlos haría que el reproceso naciera
          // ya agotado.
          attemptCount: 0,
          leaseExpiresAt: null,
          queuedAt: new Date(),
          startedAt: null,
          finishedAt: null,
        },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'BANK_STATEMENT_REVIEW_REPROCESSED',
          aggregateType: 'BankStatementRun',
          aggregateId: requestId,
          actorId: principal.id,
          requestId: principal.requestId,
          payload: { requestId, previousReviewReason: current.reviewReason },
        },
        tx,
      );
      // Dentro de la transacción por lo mismo que en el alta: Postgres sólo
      // entrega el aviso si esto confirma.
      await this.jobSignal.notify(tx, JobName.BankStatement);
    });
    const reencolado: StatementReprocessedDto = {
      requestId,
      status: WorkerRunStatus.QUEUED,
    };
    return reencolado;
  }

  private queueWhere(
    tenantId: bigint,
    query: StatementReviewQueryDto,
  ): Prisma.BankStatementRunWhereInput {
    const desde = query.dateFrom ? new Date(query.dateFrom) : undefined;
    const hasta = query.dateTo ? new Date(query.dateTo) : undefined;
    return {
      tenantId,
      // El acotamiento a los dos estados de revisión NO es un filtro más: es lo
      // que garantiza que un `PDF_INVALID` jamás aparezca aquí, con filtro o sin
      // él. Por eso se escribe antes que nada y no se deja sobreescribir.
      status: query.status ?? { in: [...REVIEW_STATUSES] },
      ...(query.category ? { reviewReason: query.category } : {}),
      ...(query.bank ? { institutionId: query.bank } : {}),
      ...(query.priority ? { reviewPriority: query.priority } : {}),
      ...(desde || hasta
        ? { reviewOpenedAt: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } }
        : {}),
    };
  }

  /** Comprueba que quien actúa es quien reclamó el caso. */
  private async assertAssignee(
    tenantId: bigint,
    requestId: string,
    principal: AuthenticatedPrincipal,
  ) {
    const run = await this.prisma.bankStatementRun.findFirst({
      where: { tenantId, requestId },
      select: {
        status: true,
        reviewReason: true,
        reviewClaimedBy: true,
        transactionCount: true,
      },
    });
    if (!run) {
      throw new DomainException(
        'BANK_STATEMENT_REVIEW_NOT_FOUND',
        'No hay ningún caso de revisión con ese identificador.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (run.status !== WorkerRunStatus.IN_REVIEW) {
      throw new DomainException(
        'BANK_STATEMENT_REVIEW_NOT_CLAIMED',
        'Hay que reclamar el caso antes de resolverlo.',
        HttpStatus.CONFLICT,
        { status: run.status },
      );
    }
    if (run.reviewClaimedBy !== principal.id) {
      throw new DomainException(
        'BANK_STATEMENT_REVIEW_ASSIGNEE_MISMATCH',
        'Sólo quien reclamó este caso puede resolverlo.',
        HttpStatus.FORBIDDEN,
      );
    }
    return {
      reviewReason: run.reviewReason,
      transactionCount: run.transactionCount,
      documentAvailable: () => this.documentAvailable(tenantId, requestId),
    };
  }

  private async currentStatus(tenantId: bigint, requestId: string): Promise<WorkerRunStatus> {
    const run = await this.prisma.bankStatementRun.findFirst({
      where: { tenantId, requestId },
      select: { status: true },
    });
    if (!run) {
      throw new DomainException(
        'BANK_STATEMENT_REVIEW_NOT_FOUND',
        'No hay ningún caso de revisión con ese identificador.',
        HttpStatus.NOT_FOUND,
      );
    }
    return run.status;
  }

  private toItem(
    row: Prisma.BankStatementRunGetPayload<{ select: typeof QUEUE_SELECTION }>,
    now: number,
  ): StatementReviewItemDto {
    return {
      requestId: row.requestId,
      fileName: row.fileName,
      requestedBy: row.requestedBy,
      status: row.status,
      // No puede ser nulo en la cola —la base lo impide— pero el tipo de Prisma
      // sí lo admite: el respaldo evita un `!` que mentiría sobre el esquema.
      reviewReason: row.reviewReason ?? StatementReviewReason.MANUAL_REQUEST,
      reviewPriority: row.reviewPriority ?? 3,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      institutionId: row.institutionId,
      documentTypeConfidence: toNumber(row.documentTypeConfidence),
      extractionConfidence: toNumber(row.confidence),
      transactionCount: row.transactionCount,
      reviewOpenedAt: row.reviewOpenedAt,
      pendingMs: elapsed(row.reviewOpenedAt, now),
      reviewClaimedBy: row.reviewClaimedBy,
      reviewClaimedAt: row.reviewClaimedAt,
      queuedAt: row.queuedAt,
    };
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

function elapsed(from: Date | null, now: number): number | null {
  return from ? Math.max(0, now - from.getTime()) : null;
}

function toNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value);
}
