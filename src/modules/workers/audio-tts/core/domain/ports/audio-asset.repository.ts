import type {
  AudioAssetRecord,
  AudioRenderIdentity,
  AudioSegmentsSummary,
  AudioTemplateRecord,
} from '../audio.types';

export interface NewAudioAsset extends AudioRenderIdentity {
  id: string;
  assetKey: string;
  templateCode: string;
  templateVersion: number;
  renderedTextEncrypted: string;
  /** Cifradas igual que el texto. Sin ellas la generación no puede cortar por segmentos. */
  variablesEncrypted?: string;
  providerModel: string;
  reservedUnits: number;
  correlationId?: string;
}

export interface MarkReadyInput {
  assetId: string;
  storageUri: string;
  mimeType: string;
  checksumSha256: string;
  bytes: number;
  usageUnits: number;
  provider: string;
  /** Presente cuando el audio se ensambló por segmentos. Viaja al resultado. */
  segmentsSummary?: AudioSegmentsSummary;
}

export interface ClaimInput {
  assetId: string;
  claimedBy: string;
  leaseSeconds: number;
  maxAttempts: number;
}

export type ClaimOutcome =
  | { outcome: 'CLAIMED'; asset: AudioAssetRecord }
  /** El asset ya está READY: el job es un duplicado legítimo y debe completarse. */
  | { outcome: 'ALREADY_READY'; asset: AudioAssetRecord }
  /** Otro worker sostiene un lease vigente. */
  | { outcome: 'LEASED_ELSEWHERE'; asset: AudioAssetRecord }
  /** Agotó los intentos permitidos: se marcó FAILED_PERMANENT. */
  | { outcome: 'EXHAUSTED'; asset: AudioAssetRecord }
  /** No existe fila para ese id: inconsistencia que debe alertarse. */
  | { outcome: 'NOT_FOUND' };

export interface AudioAssetRepositoryPort {
  findTemplate(code: string): Promise<AudioTemplateRecord | null>;
  findReadyByAssetKey(assetKey: string): Promise<AudioAssetRecord | null>;
  findById(assetId: string): Promise<AudioAssetRecord | null>;
  /** Fallback filtrado por identidad completa: nunca devuelve un audio de otro idioma o voz. */
  findReadyFallback(
    templateCode: string,
    identity: AudioRenderIdentity,
  ): Promise<AudioAssetRecord | null>;
  createPendingIfMissing(
    input: NewAudioAsset,
  ): Promise<{ asset: AudioAssetRecord; created: boolean }>;
  claimForGeneration(input: ClaimInput): Promise<ClaimOutcome>;
  /** Idempotente: devuelve false si el asset ya estaba READY. */
  markReady(input: MarkReadyInput): Promise<boolean>;
  markFailed(assetId: string, code: string, retryable: boolean): Promise<void>;
  /** Assets encallados que ninguna cola volverá a entregar. */
  findStaleAssets(staleSeconds: number, limit: number): Promise<AudioAssetRecord[]>;
  touchReconciled(assetIds: readonly string[]): Promise<void>;
}
