/** Longitud máxima admitida para un identificador de correlación. */
const MAX_CORRELATION_ID_LENGTH = 64;

/**
 * Contexto de observabilidad de una conversión.
 *
 * Es deliberadamente mínimo: solo transporta lo necesario para correlacionar
 * las trazas del worker con la solicitud que las originó. No lleva identidad,
 * tenant ni ningún dato del extracto.
 */
export interface StatementProcessingContext {
  /**
   * Identificador que enlaza las trazas de esta conversión con la solicitud
   * del anfitrión. Debe pasar por `sanitizeCorrelationId` antes de usarse.
   */
  readonly correlationId?: string;
  /**
   * Nombre original del archivo, si el anfitrión lo conoce. Viaja al resultado
   * normalizado y **nunca** a una decisión del análisis ni a una traza: lo
   * controla quien sube el documento.
   */
  readonly fileName?: string;
}

/**
 * Normaliza un identificador de correlación de origen no confiable.
 *
 * El valor llega de un encabezado HTTP, es decir, lo controla quien llama, y su
 * destino es una línea de registro. Sin normalizar, un valor con `\n` o `\r`
 * permitiría **inyectar líneas de registro falsas**: un atacante podría
 * fabricar una entrada que aparente ser un procesamiento exitoso de otra
 * entidad, o romper el análisis de un recolector de logs.
 *
 * Se admite únicamente `[A-Za-z0-9_-]`, que cubre los formatos habituales
 * (UUID, ULID, identificadores de traza de OpenTelemetry) y excluye por
 * construcción los saltos de línea, los espacios y los separadores que este
 * módulo usa en sus mensajes.
 *
 * @returns el identificador saneado, o `undefined` si no queda nada utilizable.
 */
export function sanitizeCorrelationId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, '');
  if (sanitized.length === 0) return undefined;
  return sanitized.slice(0, MAX_CORRELATION_ID_LENGTH);
}
