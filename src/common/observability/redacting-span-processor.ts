import type { Context } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { redactSqlLiterals } from './sql-redaction';

/**
 * Por qué un procesador y no un hook por instrumentación.
 *
 * Cada biblioteca instrumentada decide sus propios atributos, y esos nombres cambian al subir de
 * versión: en esta misma puesta en marcha `db.statement` pasó a `db.query.text` sólo por avanzar
 * una minor. Un saneado repartido en cinco hooks deja de cubrir en cuanto uno de esos nombres se
 * mueve, y lo hace EN SILENCIO. Aquí hay un único sitio que se aplica a todo lo que se exporta,
 * venga de donde venga.
 *
 * El riesgo concreto que cierra, y que se COMPROBÓ en este motor antes de arreglarlo: cada
 * `put`, `get` y `delete` de `ObjectStorageService` va por `fetch` a una URL firmada de MinIO,
 * con `X-Amz-Signature` y `X-Amz-Credential` en la cadena de consulta. Los objetos que guarda
 * son el carnet y la selfie del solicitante. Una traza exportada publicaba la URL entera en
 * `url.full` y `url.query`, es decir **una credencial de descarga válida** —60 segundos— para
 * un documento de identidad, en un almacén que no cifra ni audita quién lo consulta.
 *
 * Se conserva el destino y la ruta, que es lo que diagnostica.
 */

/** Atributos que se borran enteros: su valor no aporta diagnóstico y sí puede llevar secretos. */
const DELETED_ATTRIBUTES: readonly string[] = [
  // La cadena de consulta de este backend lleva identificadores (`?identifier=`,
  // `?documentNumber=`) y las firmas de los objetos almacenados.
  'url.query',
  // Sólo aparece con `enhancedDatabaseReporting`, que está apagado; se borra por si se enciende.
  'db.statement.parameters',
];

/** Atributos que se conservan sin su cadena de consulta. */
const URL_ATTRIBUTES: readonly string[] = ['url.full', 'http.url'];

/**
 * Atributos con el texto de una consulta SQL, de los que se borran los literales.
 *
 * Son DOS nombres porque la instrumentación de `pg` cambió el suyo al subir de minor
 * —`db.statement` pasó a `db.query.text`— y durante la transición publica **los dos a la vez**.
 * Un saneado que sólo cubriera el nuevo dejaría el viejo con la consulta entera, y ése es
 * exactamente el fallo silencioso que este procesador existe para evitar: aquí no hay que
 * acertar con el nombre, hay que cubrirlos todos.
 */
const SQL_ATTRIBUTES: readonly string[] = ['db.query.text', 'db.statement'];

export class RedactingSpanProcessor implements SpanProcessor {
  onStart(_span: Span, _parentContext: Context): void {
    // Nada al abrir: los atributos que importan los fija la instrumentación durante la operación.
  }

  /**
   * Se ejecuta ANTES que el procesador por lotes —el orden de la lista manda—, así que el span
   * que se exporta es el ya saneado.
   */
  onEnd(span: ReadableSpan): void {
    const attributes = span.attributes as Record<string, unknown>;
    for (const key of DELETED_ATTRIBUTES) {
      if (key in attributes) delete attributes[key];
    }
    for (const key of URL_ATTRIBUTES) {
      const value = attributes[key];
      if (typeof value === 'string') attributes[key] = stripQuery(value);
    }
    for (const key of SQL_ATTRIBUTES) {
      const value = attributes[key];
      if (typeof value === 'string') attributes[key] = redactSqlLiterals(value);
    }
  }

  async forceFlush(): Promise<void> {
    // No acumula nada: el saneado es síncrono y por span.
  }

  async shutdown(): Promise<void> {
    // Sin recursos que liberar.
  }
}

/**
 * Quita la cadena de consulta y el fragmento conservando el resto.
 *
 * Trabaja sobre la cadena y no con `new URL`: un valor que no sea una URL válida —una ruta
 * relativa, algo a medio construir— no puede hacer fallar la exportación de un lote entero.
 */
export function stripQuery(url: string): string {
  const cut = Math.min(...['?', '#'].map((mark) => indexOrEnd(url, mark)));
  return url.slice(0, cut);
}

function indexOrEnd(value: string, mark: string): number {
  const index = value.indexOf(mark);
  return index === -1 ? value.length : index;
}
