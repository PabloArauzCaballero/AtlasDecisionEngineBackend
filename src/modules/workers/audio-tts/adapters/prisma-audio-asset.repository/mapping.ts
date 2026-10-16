import { Prisma } from '@prisma/client';
import type { AudioAssetRecord, AudioSegmentsSummary } from '../../core/domain/audio.types';

/** Columnas que componen un `AudioAssetRecord`. Los bytes NUNCA están entre ellas. */
export const ASSET_SELECTION = {
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

export function toRecord(row: AssetRow): AudioAssetRecord {
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

export function isUniqueViolation(error: unknown): boolean {
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
