export interface AudioGenerationJobPayload {
  assetId: string;
  correlationId?: string;
}

export interface PublishResult {
  jobId: string | null;
  /** true cuando el singletonKey suprimió el insert: ya existe un job activo para ese asset. */
  deduplicated: boolean;
}

export interface AudioQueuePort {
  start(): Promise<void>;
  stop(): Promise<void>;
  publish(payload: AudioGenerationJobPayload): Promise<PublishResult>;
  /** Registra los consumidores de la cola principal. Un fallo afecta solo a su job. */
  consume(handler: (payload: AudioGenerationJobPayload) => Promise<void>): Promise<void>;
  /** Registra el consumidor de la dead-letter queue. */
  consumeDeadLetter(handler: (payload: AudioGenerationJobPayload) => Promise<void>): Promise<void>;
  depth(): Promise<{ queued: number; deadLetter: number }>;
}
