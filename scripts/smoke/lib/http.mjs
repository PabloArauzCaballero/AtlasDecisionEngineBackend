/**
 * Cliente HTTP del smoke.
 *
 * Todo lo que el motor rechaza sale por `DomainExceptionFilter` en forma RFC7807, con el
 * código en `error.code` y repetido en `title`. Leerlo en un solo sitio es lo que permite
 * afirmar "falló, y falló con ESTE código catalogado" en vez de "devolvió 4xx".
 */
import { config } from './config.mjs';

/** Colecciones no paginadas viajan como ARRAY DESNUDO; las paginadas, como `{ items }`. */
export function items(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.items) ? payload.items : [];
}

/**
 * Código catalogado de una respuesta de error, o `undefined` si la respuesta fue buena.
 *
 * Hay DOS envoltorios legítimos y ninguno es un descuido:
 *
 *  - RFC7807 (`error.code`) para todo lo que el filtro de excepciones rechaza;
 *  - el sobre de decisión (`errors[].code` + `reasonCodes`) cuando el motor SÍ ejecutó y
 *    concluyó NO_DECISION porque una entrada incumplía su contrato. Eso no es un error de
 *    protocolo: es un resultado, se persiste y se audita, y por eso viaja con la ejecución.
 *
 * Leer sólo el primero haría pasar por "error sin catalogar" un rechazo perfectamente
 * documentado.
 */
export function errorCode(response) {
  if (response.ok) return undefined;
  return (
    response.body?.error?.code ??
    response.body?.title ??
    response.body?.errors?.[0]?.code ??
    response.body?.reasonCodes?.[0]
  );
}

export function errorMessage(response) {
  const message = response.body?.error?.message ?? response.body?.errors?.[0]?.message;
  if (Array.isArray(message)) return message.join('; ');
  return typeof message === 'string' ? message : undefined;
}

/**
 * Ejecuta una petición y devuelve SIEMPRE un resultado descriptivo.
 *
 * Un fallo de red no lanza: se devuelve con `status: 0` y `networkError`, porque un smoke
 * que revienta en la primera petición no deja evidencia de las demás.
 */
export async function request({ method = 'GET', path, headers = {}, body, auth, raw = false }) {
  const url = `${config.baseUrl}${path}`;
  const finalHeaders = { ...(auth?.headers ?? {}), ...headers };
  const hasBody = body !== undefined;
  if (hasBody && !finalHeaders['content-type'] && !(body instanceof FormData)) {
    finalHeaders['content-type'] = 'application/json';
  }

  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: finalHeaders,
      body: hasBody ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch (error) {
    return {
      method,
      path,
      status: 0,
      ok: false,
      durationMs: Date.now() - startedAt,
      networkError: error instanceof Error ? error.message : String(error),
      body: undefined,
      text: '',
      headers: {},
    };
  }

  const text = await response.text();
  // `raw` sirve para cuerpos que NO son JSON —un CSV, un flujo SSE—, pero los errores de
  // esas mismas rutas sí llegan en JSON. Si no se parsearan, un rechazo perfectamente
  // catalogado se leería como "error sin código", que es lo contrario de lo que ocurrió.
  const isJson = (response.headers.get('content-type') ?? '').includes('json');
  let parsed;
  if (raw && !isJson) {
    parsed = undefined;
  } else {
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
  }

  return {
    method,
    path,
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    durationMs: Date.now() - startedAt,
    body: parsed,
    text,
    headers: Object.fromEntries(response.headers.entries()),
  };
}

/**
 * Repite una lectura hasta que `done` la acepte o se agote el tope.
 *
 * Con tope siempre: si un worker no está registrado la ejecución se queda en QUEUED para
 * siempre, y esperar indefinidamente parecería un cuelgue en vez de señalar el defecto.
 */
export async function pollUntil(fn, done, { timeoutMs = config.pollTimeoutMs, intervalMs = 1_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const seen = [];
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    const mark = done(last);
    if (mark?.seen !== undefined) seen.push(mark.seen);
    if (mark === true || mark?.finished) return { result: last, seen, timedOut: false };
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { result: last, seen, timedOut: true };
}
