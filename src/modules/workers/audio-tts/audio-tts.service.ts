import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AudioTemplateStrategy, Prisma, WorkerInputSource, WorkerRunStatus } from '@prisma/client';
import { DomainException } from '../../../common/errors/domain-exception';
import { persistableCarrier } from '../../../common/events/trace-carrier';
import { JobName } from '../../../common/jobs/job-names';
import { JobSignalService } from '../../../common/jobs/job-signal.service';
import { MessagingTraceService } from '../../../common/observability/messaging-trace.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../../common/security/security.types';
import { newRequestId, type ValidatedAudioInput } from './audio-tts-input';
import { AudioTtsRuntimeFactory } from './audio-tts.runtime';
import { DEFAULT_AUDIO_TEMPLATES } from './fixtures/audio-tts-fixtures';
import { templateTokens } from './core/application/template-renderer';

const TERMINAL_STATUSES: readonly WorkerRunStatus[] = [
  WorkerRunStatus.SUCCEEDED,
  WorkerRunStatus.SUCCEEDED_WITH_WARNINGS,
  WorkerRunStatus.FAILED,
  WorkerRunStatus.CANCELLED,
];

/** Lo que se devuelve al cliente. El audio NUNCA está aquí: se pide aparte. */
const RUN_SELECTION = {
  requestId: true,
  status: true,
  progress: true,
  inputSource: true,
  fixtureCode: true,
  templateCode: true,
  variablesJson: true,
  language: true,
  outcome: true,
  assetId: true,
  cacheHit: true,
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
} satisfies Prisma.AudioTtsRunSelect;

export type AudioTtsRunView = Prisma.AudioTtsRunGetPayload<{ select: typeof RUN_SELECTION }>;

/** Una plantilla, tal como la ve quien va a locutarla. */
export interface AudioTemplateView {
  code: string;
  version: number;
  strategy: AudioTemplateStrategy;
  templateText: string;
  language: string | null;
  /** Las variables que hay que rellenar, deducidas del propio texto. */
  variables: string[];
  isActive: boolean;
}

/**
 * Alta y consulta de locuciones.
 *
 * No locuta nada: crea la fila, anuncia el trabajo y responde. Locutar ocurre
 * en `AudioTtsRunWorkerService`. Misma frontera que en los otros tres workers, y
 * aquí importa más que en ninguno: mantener la petición abierta mientras un
 * proveedor de voz sintetiza es exactamente lo que un worker existe para evitar.
 */
@Injectable()
export class AudioTtsService {
  private readonly logger = new Logger(AudioTtsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobSignal: JobSignalService,
    private readonly config: ConfigService,
    private readonly messagingTrace: MessagingTraceService,
    private readonly runtime: AudioTtsRuntimeFactory,
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
    await this.ensureDefaultTemplates(tenantId);

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
      this.logger.debug(`Locución ya encolada; se devuelve ${existing.requestId}`);
      return { run: existing, deduplicated: true };
    }
  }

  async getRun(tenantId: bigint, requestId: string): Promise<AudioTtsRunView> {
    const run = await this.prisma.audioTtsRun.findFirst({
      where: { tenantId, requestId },
      select: RUN_SELECTION,
    });
    if (!run) {
      // 404 y no 403: un 403 confirmaría que la ejecución existe y que es de
      // otro, que es justo lo que no debe poder averiguarse desde fuera.
      throw new DomainException(
        'AUDIO_RUN_NOT_FOUND',
        'No existe esa locución.',
        HttpStatus.NOT_FOUND,
      );
    }
    return run;
  }

  async listRuns(
    tenantId: bigint,
    params: { page: number; pageSize: number; status?: WorkerRunStatus },
  ): Promise<{ items: AudioTtsRunView[]; total: number }> {
    const where: Prisma.AudioTtsRunWhereInput = {
      tenantId,
      ...(params.status ? { status: params.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.audioTtsRun.findMany({
        where,
        select: RUN_SELECTION,
        orderBy: { queuedAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.audioTtsRun.count({ where }),
    ]);
    return { items, total };
  }

  /**
   * Cancela una locución que todavía nadie reclamó.
   *
   * Sólo desde `QUEUED`, igual que en los otros workers: cancelar algo ya en
   * curso exigiría que el proveedor cooperase, y ofrecerlo en la interfaz sería
   * prometer algo que no se cumple. Además, a mitad de una síntesis el dinero
   * ya está gastado.
   */
  async cancelRun(tenantId: bigint, requestId: string): Promise<AudioTtsRunView> {
    const updated = await this.prisma.audioTtsRun.updateMany({
      where: { tenantId, requestId, status: WorkerRunStatus.QUEUED },
      data: { status: WorkerRunStatus.CANCELLED, finishedAt: new Date() },
    });
    if (updated.count === 0) {
      const current = await this.getRun(tenantId, requestId);
      throw new DomainException(
        'AUDIO_RUN_NOT_CANCELLABLE',
        TERMINAL_STATUSES.includes(current.status)
          ? 'La locución ya terminó.'
          : 'La locución ya está en proceso y no puede cancelarse.',
        HttpStatus.CONFLICT,
        { status: current.status },
      );
    }
    return this.getRun(tenantId, requestId);
  }

  /** El catálogo de lo que se puede locutar, con sus variables. */
  async listTemplates(tenantId: bigint): Promise<AudioTemplateView[]> {
    await this.ensureDefaultTemplates(tenantId);
    const rows = await this.prisma.audioTemplate.findMany({
      where: { tenantId, isActive: true },
      orderBy: { code: 'asc' },
    });
    return rows.map((row) => ({
      code: row.code,
      version: row.version,
      strategy: row.strategy,
      templateText: row.templateText,
      language: row.language,
      // Se deducen del texto y no se guardan en una columna: una columna se
      // desincroniza del texto en cuanto alguien edita la plantilla, y entonces
      // el formulario pide variables que ya no existen.
      variables: [...new Set(templateTokens(row.templateText))],
      isActive: row.isActive,
    }));
  }

  /**
   * Los bytes del audio de una locución terminada.
   *
   * Se leen del almacenamiento por el URI que guardó el asset, y no se aceptan
   * URIs de fuera: el que se usa sale de la fila, nunca de la petición. Es lo
   * que impide convertir esta ruta en un lector de archivos del servidor.
   */
  async readAudio(
    tenantId: bigint,
    requestId: string,
  ): Promise<{ bytes: Buffer; mimeType: string; fileName: string }> {
    const run = await this.getRun(tenantId, requestId);
    if (!run.assetId) {
      throw new DomainException(
        'AUDIO_RUN_WITHOUT_AUDIO',
        'Esta locución todavía no tiene audio.',
        HttpStatus.CONFLICT,
        { status: run.status },
      );
    }
    const { repository, storage } = this.runtime.forTenant(tenantId);
    const asset = await repository.findById(run.assetId);
    if (!asset?.storageUri) {
      throw new DomainException(
        'AUDIO_ASSET_NOT_READY',
        'El audio de esta locución ya no está disponible.',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      bytes: await storage.read(asset.storageUri),
      mimeType: asset.mimeType ?? 'application/octet-stream',
      fileName: `locucion-${requestId}.${extensionOf(asset.mimeType)}`,
    };
  }

  /**
   * La identidad de la voz vigente, condensada en una cadena.
   *
   * Entra en la clave de idempotencia. No es un adorno: un audio no es función
   * sólo del texto, sino del texto Y de con qué voz se dice, así que cambiar de
   * voz, de modelo o de formato tiene que volver a locutar en vez de devolver
   * lo que se generó con la anterior. Es la misma lección que la huella de
   * calibración del worker de identidad.
   */
  renderFingerprint(): string {
    const core = this.runtime.coreConfig();
    return [
      core.AUDIO_TTS_PROVIDER,
      core.ELEVENLABS_MODEL_ID || core.AUDIO_TTS_MODEL,
      core.ELEVENLABS_VOICE_ID || core.AUDIO_TTS_PROVIDER,
      core.AUDIO_TTS_VOICE_PROFILE,
      String(core.AUDIO_TTS_VOICE_VERSION),
      core.ELEVENLABS_OUTPUT_FORMAT || core.AUDIO_TTS_DEFAULT_FORMAT,
      String(core.AUDIO_TTS_SAMPLE_RATE),
    ].join('|');
  }

  maxTextLength(): number {
    return this.runtime.coreConfig().AUDIO_TTS_MAX_TEXT_LENGTH;
  }

  /**
   * Siembra las plantillas por omisión del tenant, una sola vez.
   *
   * Sin catálogo, la pantalla del worker se abre vacía y no hay forma de probar
   * nada; con él, hay algo que locutar desde el primer minuto. Es idempotente y
   * **no genera audio**: sembrar es escribir texto, y generar cuesta dinero. La
   * primera locución sigue siendo una decisión de una persona.
   */
  private async ensureDefaultTemplates(tenantId: bigint): Promise<void> {
    const existing = await this.prisma.audioTemplate.count({ where: { tenantId } });
    if (existing > 0) return;
    const language = this.config.get<string>('AUDIO_TTS_DEFAULT_LANGUAGE') ?? 'es-419';
    await this.prisma.audioTemplate.createMany({
      data: DEFAULT_AUDIO_TEMPLATES.map((template) => ({
        tenantId,
        code: template.code,
        version: 1,
        strategy: AudioTemplateStrategy[template.strategy],
        templateText: template.templateText,
        language,
        fallbackTemplateCode: template.fallbackTemplateCode,
      })),
      // Otra petición simultánea pudo sembrarlas entre el conteo y esto.
      skipDuplicates: true,
    });
  }
}

function extensionOf(mimeType: string | undefined): string {
  if (mimeType === 'audio/mpeg') return 'mp3';
  if (mimeType === 'audio/wav') return 'wav';
  if (mimeType === 'audio/opus') return 'opus';
  return 'bin';
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
