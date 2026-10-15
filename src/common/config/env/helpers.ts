import { z } from 'zod';

export const booleanFromString = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return value;
}, z.boolean());

/**
 * Una variable PRESENTE pero vacía es una variable ausente.
 *
 * Es lo que produce `${VAR:-}` en Docker Compose, que es como se pasa una credencial opcional:
 * cuando no está configurada, el contenedor no recibe «nada», recibe la cadena vacía. Y `''` no es
 * `undefined`, así que un `.optional()` no la salva y el `min(1)` de al lado tumba el arranque —
 * de un proceso que ni siquiera usa esa función—. Verificado en caliente: la API entró en bucle de
 * reinicio en cuanto compose empezó a pasar `LITELLM_API_KEY` vacía a los despliegues sin gateway.
 */
export const emptyAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema,
  );

/** Entero acotado. Existe para que la declaración quepa en una línea y el catálogo la lea bien. */
export const boundedInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
/** Entero acotado y opcional; vacío cuenta como ausente (ver `emptyAsUndefined`). */
export const optionalInt = (min: number, max: number) =>
  emptyAsUndefined(boundedInt(min, max).optional());

export const optionalUrl = z.string().url().optional().or(z.literal(''));
export const optionalSecret = z.string().min(24).optional().or(z.literal(''));
