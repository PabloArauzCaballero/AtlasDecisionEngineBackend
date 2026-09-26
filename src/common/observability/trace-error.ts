import { type Span, SpanStatusCode } from '@opentelemetry/api';
import { APP_ATTRIBUTES } from './telemetry.constants';

export interface SpanErrorDetails {
  /** Código estable del dominio. Si se omite, se deduce del propio error. */
  readonly code?: string;
  /** Si el fallo se cura reintentando. Distingue un corte de red de una entrada inválida. */
  readonly retryable?: boolean;
}

/**
 * Marca un span como fallido a partir de una excepción.
 *
 * Registra la excepción **una sola vez**, en el span donde nace, y usa un **código estable**
 * como descripción del estado. El mensaje del error no sirve como descripción: en este motor
 * puede contener fragmentos de las variables de decisión o del texto analizado, y nunca debe
 * salir hacia el sistema de trazas.
 *
 * No relanza ni silencia: quien llama conserva el control del flujo y el error original intacto.
 */
export function recordSpanError(span: Span, error: unknown, details: SpanErrorDetails = {}): void {
  const code = details.code ?? stableErrorCode(error);
  span.recordException(toRecordableError(error, code));
  span.setStatus({ code: SpanStatusCode.ERROR, message: code });
  span.setAttribute('error.type', code);
  const retryable = details.retryable ?? readRetryable(error);
  if (retryable !== undefined) span.setAttribute(APP_ATTRIBUTES.errorRetryable, retryable);
}

/**
 * Código estable y de baja cardinalidad.
 *
 * Se lee **estructuralmente** de la propiedad `code`, que es la convención que ya siguen las
 * dos jerarquías de error del repositorio —`DomainException` y `SemanticAnalysisError`—. Leerla
 * así, y no con un `instanceof` por cada una, evita que esta capa común dependa de ningún
 * dominio: un módulo nuevo que respete la convención queda bien clasificado sin tocar este
 * fichero.
 */
export function stableErrorCode(error: unknown): string {
  const code = readStringProperty(error, 'code');
  if (code !== undefined) return code;
  if (error instanceof Error) return error.name || 'ERROR';
  return 'UNKNOWN_ERROR';
}

function readRetryable(error: unknown): boolean | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = (error as Record<string, unknown>).retryable;
  return typeof value === 'boolean' ? value : undefined;
}

function readStringProperty(error: unknown, key: string): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * `recordException` serializa el mensaje y la pila tal cual. Un valor lanzado que no sea un
 * `Error` —una cadena con datos del solicitante, por ejemplo— se sustituye por su código
 * estable para no filtrar contenido por esta vía.
 */
function toRecordableError(error: unknown, code: string): Error {
  return error instanceof Error ? error : new Error(code);
}
