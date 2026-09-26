/**
 * Autorización del endpoint `/metrics`, en un único sitio.
 *
 * La comprobación vivía escrita dos veces —en `metrics.controller.ts` para la API y en
 * `worker.ts` para el servidor mínimo de sondas—, y las dos copias tenían que coincidir para
 * que «raspar métricas» significara lo mismo en los dos procesos. Ahora la deciden aquí.
 *
 * Se aceptan DOS portadores para el mismo secreto:
 *
 *   X-Metrics-Token: <token>        (el original; ningún cliente existente deja de funcionar)
 *   Authorization: Bearer <token>   (añadido)
 *
 * El segundo existe por una razón concreta, no por simetría: Prometheus no permite añadir
 * cabeceras arbitrarias a un `scrape_config`. Solo ofrece `basic_auth`, `oauth2` y
 * `authorization`, y esta última emite exactamente `Authorization: <type> <credentials>`.
 * Con solo `X-Metrics-Token`, un Prometheus estándar NO podía raspar este endpoint: la
 * métrica estaba publicada y protegida, pero era inalcanzable para el único consumidor que
 * se esperaba. Es una ampliación del contrato —se admite un portador más para la misma
 * credencial— y no una relajación: el secreto, su longitud mínima y la comparación en tiempo
 * constante no cambian.
 */

/** Cabecera única, aunque el cliente mande varias: dos valores no son una credencial. */
function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? undefined : value;
}

/**
 * Extrae el token presentado. `X-Metrics-Token` tiene precedencia por ser el portador
 * original; si no está, se acepta un `Authorization: Bearer`.
 *
 * El esquema se compara sin distinguir mayúsculas (RFC 7235 lo define insensible), pero el
 * valor se devuelve tal cual: recortarlo o normalizarlo haría que dos secretos distintos
 * pudieran considerarse el mismo.
 */
export function extractMetricsToken(headers: {
  'x-metrics-token'?: string | string[];
  authorization?: string | string[];
}): string | undefined {
  const direct = singleHeader(headers['x-metrics-token']);
  if (direct) return direct;

  const authorization = singleHeader(headers.authorization);
  if (!authorization) return undefined;

  const separator = authorization.indexOf(' ');
  if (separator < 0) return undefined;
  if (authorization.slice(0, separator).toLowerCase() !== 'bearer') return undefined;

  const credentials = authorization.slice(separator + 1);
  return credentials.length > 0 ? credentials : undefined;
}

/**
 * Decide si la petición puede leer las métricas.
 *
 * Con `expected` vacío el endpoint queda abierto: es el comportamiento que ya tenía, y el
 * esquema de entorno impide llegar a ese estado en producción (`METRICS_TOKEN` es obligatorio
 * cuando `METRICS_ENABLED`). Mantenerlo aquí evita que un entorno de desarrollo sin token
 * empiece a devolver 401 sin haberlo pedido nadie.
 *
 * @param equals - Comparación en tiempo constante sobre los DIGEST, no sobre las cadenas:
 *   `timingSafeEqual` exige la misma longitud, y comparar longitudes de secretos ya filtra
 *   información.
 */
export function isAuthorizedMetricsRequest(
  presented: string | undefined,
  expected: string,
  equals: (a: string, b: string) => boolean,
  digest: (value: string) => string,
): boolean {
  if (!expected) return true;
  if (!presented) return false;
  return equals(digest(presented), digest(expected));
}
