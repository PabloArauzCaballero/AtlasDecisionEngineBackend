export class AudioDomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'AudioDomainError';
  }
}

export class TtsProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'TtsProviderError';
  }
}

/** Códigos estables emitidos por la capa de resiliencia, no por el proveedor. */
export const RESILIENCE_ERROR_CODES = {
  circuitOpen: 'AUDIO_PROVIDER_CIRCUIT_OPEN',
  bulkheadFull: 'AUDIO_PROVIDER_BULKHEAD_FULL',
  bulkheadTimeout: 'AUDIO_PROVIDER_BULKHEAD_TIMEOUT',
} as const;

export function isRetryable(error: unknown): boolean {
  if (error instanceof TtsProviderError) return error.retryable;
  if (error instanceof AudioDomainError) return false;
  // Un error desconocido se considera transitorio: la cola durable decidirá cuándo rendirse.
  return true;
}

export function errorCodeOf(error: unknown): string {
  if (error instanceof TtsProviderError || error instanceof AudioDomainError) return error.code;
  return 'AUDIO_GENERATION_INFRASTRUCTURE_FAILURE';
}
