export type AudioAssetStatus =
  'PENDING' | 'GENERATING' | 'READY' | 'FAILED_RETRYABLE' | 'FAILED_PERMANENT';

export const AUDIO_ASSET_STATUSES: readonly AudioAssetStatus[] = [
  'PENDING',
  'GENERATING',
  'READY',
  'FAILED_RETRYABLE',
  'FAILED_PERMANENT',
];

export type AudioTemplateStrategy = 'STATIC' | 'DYNAMIC' | 'FALLBACK';

export interface AudioTemplateRecord {
  code: string;
  version: number;
  strategy: AudioTemplateStrategy;
  templateText: string;
  language?: string;
  fallbackTemplateCode?: string;
  isActive: boolean;
}

/**
 * Dimensiones que definen la identidad criptográfica de un asset.
 * Cualquier cambio produce un asset distinto y nunca sobrescribe uno READY.
 */
export interface AudioRenderIdentity {
  language: string;
  provider: string;
  model: string;
  providerVoiceRef: string;
  voiceProfile: string;
  voiceVersion: number;
  outputFormat: string;
  sampleRate: number;
}

/**
 * Cómo se compuso el audio: cuántos tramos, cuántos ya estaban dichos y cuántos
 * pagó esta generación. Publicarlo es parte del contrato de honestidad del
 * worker: un audio ensamblado pierde continuidad de prosodia en las costuras, y
 * quien lo escucha tiene derecho a saber que oye tramos cosidos, no una toma.
 */
export interface AudioSegmentsSummary {
  total: number;
  cached: number;
  generated: number;
}

export interface AudioAssetRecord extends AudioRenderIdentity {
  id: string;
  assetKey: string;
  templateCode: string;
  templateVersion: number;
  status: AudioAssetStatus;
  renderedTextEncrypted: string;
  /** Las variables de la frase, cifradas igual que el texto. Sin ellas no hay corte por segmentos. */
  variablesEncrypted?: string;
  segmentsSummary?: AudioSegmentsSummary;
  providerModel: string;
  reservedUnits: number;
  attempts: number;
  correlationId?: string;
  claimedAt?: Date;
  claimedBy?: string;
  storageUri?: string;
  mimeType?: string;
  checksumSha256?: string;
  bytes?: number;
  lastErrorCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResolveAudioRequest {
  templateCode: string;
  variables?: Record<string, string>;
  actorId?: string;
  language?: string;
  correlationId?: string;
}

export type ResolveAudioResult =
  | { status: 'READY'; assetId: string; storageUri: string; cacheHit: true }
  | { status: 'QUEUED'; assetId: string; cacheHit: false }
  | { status: 'FALLBACK'; assetId: string; storageUri: string; reason: string }
  /** Degradación final: no hay audio disponible. El host debe continuar sin audio, nunca fallar. */
  | { status: 'UNAVAILABLE'; reason: string };
