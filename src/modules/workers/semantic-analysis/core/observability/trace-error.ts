import { type Span, SpanStatusCode } from '@opentelemetry/api';
import { APP_ATTRIBUTES } from './telemetry.constants';
import { isRetryable, toStableErrorCode } from '../domain/semantic-analysis.errors';

/**
 * Marca un span como fallido a partir de una excepción.
 *
 * Registra la excepción **una sola vez**, en el span donde se origina, y usa el código estable del
 * dominio como descripción del estado. El mensaje del error no se usa como descripción: puede
 * contener fragmentos del texto analizado, que nunca debe salir del proceso hacia el backend de
 * trazas.
 *
 * No relanza ni silencia: quien llama conserva el control del flujo y el error original intacto.
 *
 * @param span - Span activo que representa la operación fallida.
 * @param error - Excepción capturada, de cualquier tipo.
 */
export function recordSpanError(span: Span, error: unknown): void {
  const code = toStableErrorCode(error);
  span.recordException(toRecordableError(error));
  span.setStatus({ code: SpanStatusCode.ERROR, message: code });
  span.setAttribute('error.type', code);
  span.setAttribute(APP_ATTRIBUTES.errorRetryable, isRetryable(error));
}

/**
 * `recordException` serializa el mensaje y la pila del error tal cual. Un valor lanzado que no sea
 * un `Error` —una cadena con el texto analizado, por ejemplo— se sustituye por su código estable
 * para no filtrar contenido por esta vía.
 */
function toRecordableError(error: unknown): Error {
  return error instanceof Error ? error : new Error(toStableErrorCode(error));
}
