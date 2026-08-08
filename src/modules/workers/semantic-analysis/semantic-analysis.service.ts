import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WorkerInputSource, WorkerRunStatus } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { DomainException } from '../../../common/errors/domain-exception';
import { JobName } from '../../../common/jobs/job-names';
import { JobSignalService } from '../../../common/jobs/job-signal.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../../common/security/security.types';
import { persistableCarrier } from '../../../common/events/trace-carrier';
import { MessagingTraceService } from '../../../common/observability/messaging-trace.service';

/**
 * Todo lo que ocupa sitio sin mostrar nada.
 *
 * `\s` no basta: los espacios de ancho cero (U+200B–U+200D), la marca de orden
 * de bytes (U+FEFF), el guion suave (U+00AD) y las marcas de direccionalidad
 * (U+200E–U+200F, U+202A–U+202E, U+2066–U+2069) NO son espacio en blanco para
 * el motor de expresiones regulares, así que un texto compuesto sólo por ellos
 * tiene longitud y no tiene contenido. Es exactamente la entrada que hay que
 * rechazar antes de gastar una llamada al proveedor de modelos.
 *
 * Escrito con escapes y no con los caracteres literales: en el fuente son
 * invisibles, y una regla que nadie puede leer es una regla que nadie revisa.
 */
const INVISIBLE_RUN = /[\s\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]+/g;

const RUN_SELECTION = {
  requestId: true,
  status: true,
  progress: true,
  inputSource: true,
  fixtureCode: true,
  resultJson: true,
  warningsJson: true,
  errorCode: true,
  errorMessage: true,
  attemptCount: true,
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
  requestedBy: true,
  correlationId: true,
} satisfies Prisma.SemanticAnalysisRunSelect;

export type SemanticRunView = Prisma.SemanticAnalysisRunGetPayload<{
  select: typeof RUN_SELECTION;
}>;

const TERMINAL_STATUSES: readonly WorkerRunStatus[] = [
  WorkerRunStatus.SUCCEEDED,
  WorkerRunStatus.SUCCEEDED_WITH_WARNINGS,
  WorkerRunStatus.FAILED,
  WorkerRunStatus.CANCELLED,
];

/**
 * Alta y consulta de análisis semánticos.
 *
 * Igual que su equivalente de extractos, no analiza nada: escribe la fila,
 * anuncia el trabajo y responde. El análisis lo hace el processor absorbido,
 * en el proceso worker.
 */
@Injectable()
export class SemanticAnalysisService {
  private readonly logger = new Logger(SemanticAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobSignal: JobSignalService,
    private readonly config: ConfigService,
    private readonly messagingTrace: MessagingTraceService,
  ) {}

  /**
   * Valida el texto antes de crear nada.
   *
   * Es la misma comprobación para un fixture y para una entrada real. Se hace
   * aquí y no sólo en el núcleo porque un texto vacío no debe llegar siquiera a
   * ocupar una fila y un puesto en la cola.
   */
  validateText(text: string): string {
    const maxLength = this.config.get<number>('SEMANTIC_ANALYSIS_MAX_TEXT_LENGTH') ?? 8_000;
    // Se normaliza ANTES de medir: un texto de espacios de ancho cero tiene
    // longitud y no tiene contenido, y es justo la entrada que hay que rechazar.
    const normalized = text.replace(INVISIBLE_RUN, ' ').trim();
    if (normalized.length === 0) {
      throw new DomainException(
        'SEMANTIC_TEXT_EMPTY',
        'El texto a analizar está vacío.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (text.length > maxLength) {
      throw new DomainException(
        'SEMANTIC_TEXT_TOO_LONG',
        `El texto supera el máximo de ${maxLength} caracteres.`,
        HttpStatus.BAD_REQUEST,
        { maxLength, receivedLength: text.length },
      );
    }
    return text;
  }

  async createRun(
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    text: string,
    source: WorkerInputSource,
    options: { fixtureCode?: string; idempotencyKey?: string } = {},
  ): Promise<{ run: SemanticRunView; deduplicated: boolean }> {
    // Sin clave explícita se deriva del contenido: reenviar el mismo texto no
    // debe crear un segundo análisis ni gastar cuota dos veces. Que el
    // llamante pueda darla es lo que le permite forzar un reanálisis de un
    // texto idéntico cuando el catálogo cambió.
    const idempotencyKey =
      options.idempotencyKey ?? createHash('sha256').update(text).digest('hex');

    try {
      const run = await this.prisma.$transaction(async (tx) => {
        const created = await tx.semanticAnalysisRun.create({
          data: {
            tenantId,
            requestId: randomUUID(),
            idempotencyKey,
            status: WorkerRunStatus.QUEUED,
            inputSource: source,
            inputText: text,
            fixtureCode: options.fixtureCode ?? null,
            requestedBy: principal.id,
            correlationId: principal.requestId,
            // Contexto de traza capturado AQUÍ, en el proceso de API: tras el commit se pierde,
            // y el worker que reclame esta fila en otro proceso ya no podría recuperarlo. Sin
            // traza activa queda nulo y el worker abre una traza raíz.
            traceCarrier: persistableCarrier(this.messagingTrace.inject()),
          },
          select: RUN_SELECTION,
        });
        await this.jobSignal.notify(tx, JobName.SemanticAnalysis);
        return created;
      });
      return { run, deduplicated: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.semanticAnalysisRun.findFirst({
        where: { tenantId, idempotencyKey },
        select: RUN_SELECTION,
      });
      if (!existing) throw error;
      this.logger.debug(`Análisis ya encolado con esa clave; se devuelve ${existing.requestId}`);
      return { run: existing, deduplicated: true };
    }
  }

  async getRun(tenantId: bigint, requestId: string): Promise<SemanticRunView> {
    const run = await this.prisma.semanticAnalysisRun.findFirst({
      where: { tenantId, requestId },
      select: RUN_SELECTION,
    });
    if (!run) {
      throw new DomainException(
        'SEMANTIC_RUN_NOT_FOUND',
        'No existe ese análisis.',
        HttpStatus.NOT_FOUND,
      );
    }
    return run;
  }

  async listRuns(
    tenantId: bigint,
    params: { page: number; pageSize: number; status?: WorkerRunStatus },
  ): Promise<{ items: SemanticRunView[]; total: number }> {
    const where: Prisma.SemanticAnalysisRunWhereInput = {
      tenantId,
      ...(params.status ? { status: params.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.semanticAnalysisRun.findMany({
        where,
        select: RUN_SELECTION,
        orderBy: { queuedAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.semanticAnalysisRun.count({ where }),
    ]);
    return { items, total };
  }

  async cancelRun(tenantId: bigint, requestId: string): Promise<SemanticRunView> {
    const updated = await this.prisma.semanticAnalysisRun.updateMany({
      where: { tenantId, requestId, status: WorkerRunStatus.QUEUED },
      data: { status: WorkerRunStatus.CANCELLED, finishedAt: new Date() },
    });
    if (updated.count === 0) {
      const current = await this.getRun(tenantId, requestId);
      throw new DomainException(
        'SEMANTIC_RUN_NOT_CANCELLABLE',
        TERMINAL_STATUSES.includes(current.status)
          ? 'El análisis ya terminó.'
          : 'El análisis ya está en curso y no puede cancelarse.',
        HttpStatus.CONFLICT,
        { status: current.status },
      );
    }
    return this.getRun(tenantId, requestId);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
