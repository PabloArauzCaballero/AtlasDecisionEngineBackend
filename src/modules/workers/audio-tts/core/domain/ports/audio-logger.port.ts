export type AudioLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AudioLogContext {
  event: string;
  correlationId?: string;
  assetId?: string;
  templateCode?: string;
  provider?: string;
  code?: string;
  durationMs?: number;
  [key: string]: unknown;
}

/**
 * Puerto de logging. El host puede inyectar su logger institucional; la
 * implementación incluida emite JSON estructurado a stdout con redacción.
 */
export interface AudioLoggerPort {
  debug(context: AudioLogContext): void;
  info(context: AudioLogContext): void;
  warn(context: AudioLogContext): void;
  error(context: AudioLogContext & { error?: unknown }): void;
  child(bindings: Record<string, unknown>): AudioLoggerPort;
}
