/**
 * El MISMO HMAC que firma la cadena de auditoría y seudonimiza al solicitante, disponible
 * fuera de Nest.
 *
 * `HashService` es un proveedor inyectable y depende de `ConfigService`; la siembra corre
 * también por CLI (`prisma db seed`), donde no hay contenedor de inyección. Reimplementar
 * el algoritmo aquí sería la salida fácil y la equivocada: dos implementaciones del hash
 * que firma la evidencia se separan en cuanto una cambia, y el síntoma es una cadena que
 * el portal declara ROTA sin que nadie haya tocado un evento.
 *
 * Por eso esto NO reimplementa nada: reproduce literalmente las tres líneas de
 * `HashService.hmacWithKey` —clave activa, canonicalización compartida, HMAC-SHA256— y la
 * prueba `audit-seed-hash.spec.ts` fija que las dos den lo mismo. Si alguna vez difieren,
 * lo dice una prueba y no la pantalla de integridad.
 */
import { createHmac } from 'node:crypto';
import { canonicalize } from '../../../common/crypto/canonical-json';

/** Identificador de la clave con la que se firma. Espejo de `AUDIT_HASH_KEY_ID`. */
export function seedHashKeyId(env: NodeJS.ProcessEnv = process.env): string {
  return env.AUDIT_HASH_KEY_ID ?? 'v1';
}

/**
 * Firma con el secreto activo.
 *
 * Falla en vez de degradar a un secreto por omisión: una cadena firmada con «changeme»
 * verifica igual de bien y no prueba nada, que es peor que no tener cadena — porque la
 * pantalla la enseñaría en verde.
 */
export function seedHmac(value: unknown, env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.AUDIT_HASH_SECRET;
  if (!secret) {
    throw new Error(
      'AUDIT_HASH_SECRET no está definido: la siembra de auditoría no puede firmar la cadena.',
    );
  }
  const data = typeof value === 'string' ? value : canonicalize(value);
  return createHmac('sha256', secret).update(data).digest('hex');
}

/** ¿Se puede firmar en esta corrida? La siembra base no debe caerse por no poder hacerlo. */
export function canSignAuditSeed(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.AUDIT_HASH_SECRET);
}
