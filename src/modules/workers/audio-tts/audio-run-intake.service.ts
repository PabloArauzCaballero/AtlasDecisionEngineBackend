import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WorkerInputSource, WorkerRunStatus } from '@prisma/client';
import { persistableCarrier } from '../../../common/events/trace-carrier';
import { JobName } from '../../../common/jobs/job-names';
import { JobSignalService } from '../../../common/jobs/job-signal.service';
import { MessagingTraceService } from '../../../common/observability/messaging-trace.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../../common/security/security.types';
import { newRequestId, type ValidatedAudioInput } from './audio-tts-input';
import { AudioRunService } from './audio-run.service';
import { AudioTemplateCatalogService } from './audio-template-catalog.service';
import { RETRYABLE_STATUSES, RUN_SELECTION, type AudioTtsRunView } from './audio-run.view';

/** Alta de locuciones: encola una nueva o devuelve la ya pedida, por la clave de idempotencia. */
@Injectable()
export class AudioRunIntakeService {
  private readonly logger = new Logger(AudioRunIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobSignal: JobSignalService,
    private readonly messagingTrace: MessagingTraceService,
    private readonly templates: AudioTemplateCatalogService,
    private readonly runs: AudioRunService,
  ) {}

  /**
   * Encola una locución.
   *
   * Reenviar la misma solicitud devuelve la ejecución que ya existe en vez de
   * crear una segunda. La deduplicación se apoya en el índice único
   * `(tenant_id, idempotency_key)` y **no** en una consulta previa: dos
   * peticiones simultáneas pasan las dos por un `SELECT` que no ve nada, y el
   * precio de que entren las dos es una locución pagada dos veces.
   */
  async createRun(
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    input: ValidatedAudioInput,
    source: WorkerInputSource,
    options: { fixtureCode?: string } = {},
  ): Promise<{ run: AudioTtsRunView; deduplicated: boolean }> {
    await this.templates.ensureDefaultTemplates(tenantId);

    try {
      const run = await this.prisma.$transaction(async (tx) => {
        const created = await tx.audioTtsRun.create({
          data: {
            tenantId,
            requestId: newRequestId(),
            idempotencyKey: input.idempotencyKey,
            status: WorkerRunStatus.QUEUED,
            inputSource: source,
            fixtureCode: options.fixtureCode ?? null,
            templateCode: input.templateCode,
            variablesJson: input.variables as Prisma.InputJsonValue,
            language: input.language,
            requestedBy: principal.id,
            correlationId: principal.requestId,
            traceCarrier: persistableCarrier(this.messagingTrace.inject()),
          },
          select: RUN_SELECTION,
        });
        // Dentro de la transacción a propósito: Postgres sólo entrega el aviso
        // si esto confirma, así que el worker nunca busca una ejecución que se
        // deshizo ni la busca antes de que sea visible.
        await this.jobSignal.notify(tx, JobName.AudioTts);
        return created;
      });
      return { run, deduplicated: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.audioTtsRun.findFirst({
        where: { tenantId, idempotencyKey: input.idempotencyKey },
        select: RUN_SELECTION,
      });
      if (!existing) throw error;
      /*
       * Un intento sin resultado (FALLIDO o CANCELADO) no se sirve de la caché: la clave se deriva
       * del contenido y no caduca, así que la misma frase respondía con aquel fallo PARA SIEMPRE
       * (presupuesto de fin de mes, caída del proveedor, una cancelación). Se reencola la misma
       * fila —el `requestId` es el que alguien puede estar siguiendo—, y el UPDATE condicionado al
       * estado hace que dos reenvíos simultáneos sólo reencolen una vez.
       */
      if (RETRYABLE_STATUSES.includes(existing.status)) {
        const requeued = await this.requeue(tenantId, principal, existing.requestId);
        if (requeued) return { run: requeued, deduplicated: false };
        const current = await this.runs.getRun(tenantId, existing.requestId);
        return { run: current, deduplicated: true };
      }
      this.logger.debug(`Locución ya encolada; se devuelve ${existing.requestId}`);
      return { run: existing, deduplicated: true };
    }
  }

  /** Devuelve a la cola una locución que terminó sin resultado; `null` si otro ya lo hizo. */
  private async requeue(
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    requestId: string,
  ): Promise<AudioTtsRunView | null> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.audioTtsRun.updateMany({
        where: { tenantId, requestId, status: { in: [...RETRYABLE_STATUSES] } },
        data: {
          status: WorkerRunStatus.QUEUED,
          progress: 0,
          outcome: null,
          assetId: null,
          cacheHit: false,
          resultJson: Prisma.DbNull,
          warningsJson: Prisma.DbNull,
          errorCode: null,
          errorMessage: null,
          attemptCount: 0,
          leaseExpiresAt: null,
          queuedAt: new Date(),
          startedAt: null,
          finishedAt: null,
          requestedBy: principal.id,
          correlationId: principal.requestId,
          traceCarrier: persistableCarrier(this.messagingTrace.inject()),
        },
      });
      if (updated.count === 0) return null;
      await this.jobSignal.notify(tx, JobName.AudioTts);
      return tx.audioTtsRun.findFirst({ where: { tenantId, requestId }, select: RUN_SELECTION });
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
