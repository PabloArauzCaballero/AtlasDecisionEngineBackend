/**
 * Construcción de la clave de idempotencia efectiva.
 *
 * NO se usa la cadena que manda el cliente tal cual. La clave real es
 * `clave + template@versión + marca + huella del payload`, y el motivo es concreto: un
 * cliente que reutiliza «pedido-4821» para dos documentos distintos —cosa que pasa— recibiría
 * el primero disfrazado de segundo, y ese fallo es silencioso, tardío y prácticamente
 * imposible de diagnosticar desde el lado del consumidor.
 *
 * Con la huella dentro, el reenvío exacto se reconoce y la reutilización indebida genera un
 * documento nuevo. Se paga en que un reenvío con un espacio en blanco de diferencia cuenta
 * como petición nueva; es el lado correcto por el que equivocarse.
 */
import { createHash } from 'node:crypto';

/**
 * JSON canónico: claves ordenadas en todos los niveles.
 *
 * `JSON.stringify` conserva el orden de inserción, así que `{a:1,b:2}` y `{b:2,a:1}` —el
 * mismo payload, serializado por dos clientes distintos— darían huellas distintas y la
 * idempotencia dejaría de funcionar justo entre servicios, que es donde hace falta.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(',')}}`;
}

export function payloadFingerprint(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

export interface IdempotencyScope {
  readonly idempotencyKey: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly brandId: string;
  readonly payload: unknown;
}

export function buildIdempotencyKey(scope: IdempotencyScope): string {
  const material = [
    scope.idempotencyKey,
    `${scope.templateId}@${scope.templateVersion}`,
    scope.brandId,
    payloadFingerprint(scope.payload),
  ].join('|');
  return `pdf:${createHash('sha256').update(material).digest('hex')}`;
}
