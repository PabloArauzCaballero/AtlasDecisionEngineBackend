export interface TtsSynthesisInput {
  text: string;
  language: string;
  voiceProfile: string;
  providerVoiceRef: string;
  model: string;
  outputFormat: string;
  sampleRate: number;
  requestId: string;
}

export interface TtsSynthesisResult {
  audio: Buffer;
  /** Tipo real devuelto por el proveedor, no el solicitado. */
  mimeType: string;
  provider: string;
  model: string;
  requestId?: string;
  /** Consumo reportado por el proveedor cuando está disponible; estimación local si no. */
  usageUnits: number;
  usageIsReported: boolean;
  durationMs: number;
}

export interface TtsProviderHealth {
  provider: string;
  configured: boolean;
}

export interface TtsProviderPort {
  readonly providerName: string;
  synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult>;
  health(): Promise<TtsProviderHealth>;
}
