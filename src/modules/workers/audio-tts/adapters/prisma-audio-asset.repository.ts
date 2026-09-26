/**
 * Catálogo y caché de audio sobre Prisma, acotados a UN tenant.
 *
 * El paquete original hablaba Sequelize contra su propio esquema `audio_tts`.
 * Aquí vive en el mismo ORM y el mismo esquema que el resto del motor, igual
 * que el catálogo del worker semántico: dos ORM contra la misma base parten las
 * transacciones en dos.
 *
 * **Se construye por tenant y no como singleton**, que es la diferencia más
 * importante respecto del paquete. El puerto no lleva `tenantId` en ninguna
 * firma —el paquete servía a una sola organización—, así que el aislamiento
 * tiene que estar en la instancia: cada `WHERE` de este archivo lo lleva puesto
 * y no depende de que quien llama se acuerde. La política de RLS de las tablas
 * es la segunda línea, no la primera.
 */
import { AudioAssetStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type {
  AudioAssetRecord,
  AudioRenderIdentity,
  AudioSegmentsSummary,
  AudioTemplateRecord,
} from '../core/domain/audio.types';
import type {
  AudioAssetRepositoryPort,
  ClaimInput,
  ClaimOutcome,
  MarkReadyInput,
  NewAudioAsset,
} from '../core/domain/ports/audio-asset.repository';

/** Columnas que componen un `AudioAssetRecord`. Los bytes NUNCA están entre ellas. */
const ASSET_SELECTION = {
  id: true,
  assetKey: true,
  templateCode: true,
  templateVersion: true,
  status: true,
  renderedTextEncrypted: true,
  variablesEncrypted: true,
  segmentsSummary: true,
  providerModel: true,
  reservedUnits: true,
  attempts: true,
  correlationId: true,
  claimedAt: true,
  claimedBy: true,
  storageUri: true,
  mimeType: true,
  checksumSha256: true,
  bytes: true,
  lastErrorCode: true,
  language: true,
  provider: true,
  providerVoiceRef: true,
  voiceProfile: true,
  voiceVersion: true,
  outputFormat: true,
  sampleRate: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AudioAssetSelect;

type AssetRow = Prisma.AudioAssetGetPayload<{ select: typeof ASSET_SELECTION }>;

export class PrismaAudioAssetRepository implements AudioAssetRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantId: bigint,
  ) {}

  async findTemplate(code: string): Promise<AudioTemplateRecord | null> {
    const row = await this.prisma.audioTemplate.findFirst({
      where: { tenantId: this.tenantId, code },
    });
    if (!row) return null;
    return {
      code: row.code,
      version: row.version,
      strategy: row.strategy,
      templateText: row.templateText,
      ...(row.language ? { language: row.language } : {}),
      ...(row.fallbackTemplateCode ? { fallbackTemplateCode: row.fallbackTemplateCode } : {}),
      isActive: row.isActive,
    };
  }

  async findReadyByAssetKey(assetKey: string): Promise<AudioAssetRecord | null> {
    const row = await this.prisma.audioAsset.findFirst({
      where: { tenantId: this.tenantId, assetKey, status: AudioAssetStatus.READY },
      select: ASSET_SELECTION,
    });
    return row ? toRecord(row) : null;
  }

  async findById(assetId: string): Promise<AudioAssetRecord | null> {
    const row = await this.prisma.audioAsset.findFirst({
      where: { tenantId: this.tenantId, id: assetId },
      select: ASSET_SELECTION,
    });
    return row ? toRecord(row) : null;
  }

  /**
   * Un respaldo sólo sirve si es EQUIVALENTE: mismo idioma, misma voz, mismo
   * formato. Filtrar sólo por plantilla devolvería el audio en inglés de otro
   * despliegue como si fuera el respaldo de éste.
   */
  async findReadyFallback(
    templateCode: string,
    identity: AudioRenderIdentity,
  ): Promise<AudioAssetRecord | null> {
    const row = await this.prisma.audioAsset.findFirst({
      where: {
        tenantId: this.tenantId,
        templateCode,
        status: AudioAssetStatus.READY,
        language: identity.language,
        provider: identity.provider,
        providerVoiceRef: identity.providerVoiceRef,
        voiceProfile: identity.voiceProfile,
        voiceVersion: identity.voiceVersion,
        outputFormat: identity.outputFormat,
        sampleRate: identity.sampleRate,
      },
      select: ASSET_SELECTION,
      orderBy: { updatedAt: 'desc' },
    });
    return row ? toRecord(row) : null;
  }

  /**
   * Crea el asset pendiente, o devuelve el que ya existía.
   *
   * Se apoya en el índice único `(tenant_id, asset_key)` y **no** en una
   * consulta previa: dos peticiones simultáneas de la misma frase pasan las dos
   * por un `SELECT` que no ve nada, y acabarían pagando dos veces por el mismo
   * audio. `created: false` es lo que hace que quien pierde la carrera devuelva
   * su reserva de presupuesto.
   */
  async createPendingIfMissing(
    input: NewAudioAsset,
  ): Promise<{ asset: AudioAssetRecord; created: boolean }> {
    try {
      const created = await this.prisma.audioAsset.create({
        data: {
          id: input.id,
          tenantId: this.tenantId,
          assetKey: input.assetKey,
          templateCode: input.templateCode,
          templateVersion: input.templateVersion,
          status: AudioAssetStatus.PENDING,
          renderedTextEncrypted: input.renderedTextEncrypted,
          variablesEncrypted: input.variablesEncrypted ?? null,
          providerModel: input.providerModel,
          reservedUnits: input.reservedUnits,
          correlationId: input.correlationId ?? null,
          language: input.language,
          provider: input.provider,
          providerVoiceRef: input.providerVoiceRef,
          voiceProfile: input.voiceProfile,
          voiceVersion: input.voiceVersion,
          outputFormat: input.outputFormat,
          sampleRate: input.sampleRate,
        },
        select: ASSET_SELECTION,
      });
      return { asset: toRecord(created), created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.audioAsset.findFirst({
        where: { tenantId: this.tenantId, assetKey: input.assetKey },
        select: ASSET_SELECTION,
      });
      if (!existing) throw error;
      return { asset: toRecord(existing), created: false };
    }
  }

  /**
   * Toma la generación en exclusiva, con arrendamiento.
   *
   * Es una sola sentencia condicional y no un «leer, decidir, escribir»: entre
   * la lectura y la escritura cabe otra réplica entera, y el precio de que
   * entren dos es una locución pagada dos veces. El `UPDATE … WHERE` que exige
   * que el arrendamiento esté vencido decide en la base, que es donde no hay
   * ventana.
   */
  async claimForGeneration(input: ClaimInput): Promise<ClaimOutcome> {
    const current = await this.findById(input.assetId);
    if (!current) return { outcome: 'NOT_FOUND' };
    if (current.status === 'READY') return { outcome: 'ALREADY_READY', asset: current };
    if (current.attempts >= input.maxAttempts) {
      await this.prisma.audioAsset.updateMany({
        where: {
          tenantId: this.tenantId,
          id: input.assetId,
          status: { not: AudioAssetStatus.READY },
        },
        data: { status: AudioAssetStatus.FAILED_PERMANENT, claimedAt: null, claimedBy: null },
      });
      return { outcome: 'EXHAUSTED', asset: { ...current, status: 'FAILED_PERMANENT' } };
    }

    const now = new Date();
    const leaseFloor = new Date(now.getTime() - input.leaseSeconds * 1_000);
    const claimed = await this.prisma.audioAsset.updateMany({
      where: {
        tenantId: this.tenantId,
        id: input.assetId,
        status: {
          in: [
            AudioAssetStatus.PENDING,
            AudioAssetStatus.GENERATING,
            AudioAssetStatus.FAILED_RETRYABLE,
          ],
        },
        // Libre, o con el arrendamiento del anterior ya vencido.
        OR: [{ claimedAt: null }, { claimedAt: { lt: leaseFloor } }],
      },
      data: {
        status: AudioAssetStatus.GENERATING,
        claimedAt: now,
        claimedBy: input.claimedBy,
        attempts: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      return { outcome: 'LEASED_ELSEWHERE', asset: current };
    }
    const fresh = await this.findById(input.assetId);
    return fresh ? { outcome: 'CLAIMED', asset: fresh } : { outcome: 'NOT_FOUND' };
  }

  /**
   * Cierra la generación. Devuelve `false` si el asset ya estaba `READY`, y esa
   * respuesta es lo que impide liquidar dos veces el mismo consumo cuando un
   * trabajo duplicado llega tarde.
   */
  async markReady(input: MarkReadyInput): Promise<boolean> {
    const updated = await this.prisma.audioAsset.updateMany({
      where: {
        tenantId: this.tenantId,
        id: input.assetId,
        status: { not: AudioAssetStatus.READY },
      },
      data: {
        status: AudioAssetStatus.READY,
        storageUri: input.storageUri,
        mimeType: input.mimeType,
        checksumSha256: input.checksumSha256,
        bytes: BigInt(input.bytes),
        segmentsSummary: input.segmentsSummary
          ? (input.segmentsSummary as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
        claimedAt: null,
        claimedBy: null,
        lastErrorCode: null,
      },
    });
    return updated.count > 0;
  }

  async markFailed(assetId: string, code: string, retryable: boolean): Promise<void> {
    await this.prisma.audioAsset.updateMany({
      where: { tenantId: this.tenantId, id: assetId, status: { not: AudioAssetStatus.READY } },
      data: {
        status: retryable ? AudioAssetStatus.FAILED_RETRYABLE : AudioAssetStatus.FAILED_PERMANENT,
        lastErrorCode: code,
        claimedAt: null,
        claimedBy: null,
      },
    });
  }

  /**
   * Assets encallados: prometieron un audio y nadie los está generando.
   *
   * En el paquete los buscaba un reconciliador porque su cola podía perder un
   * mensaje. Aquí la cola es la tabla de ejecuciones, así que esto queda como
   * red de seguridad de lo que sí puede pasar: un proceso que muere con el
   * arrendamiento tomado.
   */
  async findStaleAssets(staleSeconds: number, limit: number): Promise<AudioAssetRecord[]> {
    const floor = new Date(Date.now() - staleSeconds * 1_000);
    const rows = await this.prisma.audioAsset.findMany({
      where: {
        tenantId: this.tenantId,
        status: { in: [AudioAssetStatus.PENDING, AudioAssetStatus.GENERATING] },
        updatedAt: { lt: floor },
      },
      select: ASSET_SELECTION,
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    return rows.map(toRecord);
  }

  /** Marca el paso del reconciliador sin cambiar de estado. */
  async touchReconciled(assetIds: readonly string[]): Promise<void> {
    if (assetIds.length === 0) return;
    await this.prisma.audioAsset.updateMany({
      where: { tenantId: this.tenantId, id: { in: [...assetIds] } },
      data: { claimedAt: null, claimedBy: null },
    });
  }
}

function toRecord(row: AssetRow): AudioAssetRecord {
  return {
    id: row.id,
    assetKey: row.assetKey.trim(),
    templateCode: row.templateCode,
    templateVersion: row.templateVersion,
    status: row.status,
    renderedTextEncrypted: row.renderedTextEncrypted,
    ...(row.variablesEncrypted ? { variablesEncrypted: row.variablesEncrypted } : {}),
    ...(esResumenDeSegmentos(row.segmentsSummary) ? { segmentsSummary: row.segmentsSummary } : {}),
    providerModel: row.providerModel,
    model: row.providerModel,
    reservedUnits: row.reservedUnits,
    attempts: row.attempts,
    ...(row.correlationId ? { correlationId: row.correlationId } : {}),
    ...(row.claimedAt ? { claimedAt: row.claimedAt } : {}),
    ...(row.claimedBy ? { claimedBy: row.claimedBy } : {}),
    ...(row.storageUri ? { storageUri: row.storageUri } : {}),
    ...(row.mimeType ? { mimeType: row.mimeType } : {}),
    ...(row.checksumSha256 ? { checksumSha256: row.checksumSha256.trim() } : {}),
    ...(row.bytes === null ? {} : { bytes: Number(row.bytes) }),
    ...(row.lastErrorCode ? { lastErrorCode: row.lastErrorCode } : {}),
    language: row.language,
    provider: row.provider,
    providerVoiceRef: row.providerVoiceRef,
    voiceProfile: row.voiceProfile,
    voiceVersion: row.voiceVersion,
    outputFormat: row.outputFormat,
    sampleRate: row.sampleRate,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * El JSON de la base sólo se promociona a resumen si tiene la forma del
 * resumen: un valor manipulado o de una versión vieja se descarta en vez de
 * viajar al resultado con pinta de dato.
 */
function esResumenDeSegmentos(valor: unknown): valor is AudioSegmentsSummary {
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const puede = valor as Record<string, unknown>;
  return (
    typeof puede.total === 'number' &&
    typeof puede.cached === 'number' &&
    typeof puede.generated === 'number'
  );
}
