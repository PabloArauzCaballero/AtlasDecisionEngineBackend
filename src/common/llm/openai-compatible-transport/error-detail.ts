import { ERROR_CODE_SHAPE, saysQuotaExhausted } from './error-signatures';

/**
 * Extrae `error.code` (o `error.type`) del cuerpo de un error.
 *
 * Nunca propaga un fallo propio: un cuerpo vacío, truncado o que no sea JSON
 * deja el código sin determinar, y la clasificación cae de vuelta en el estado
 * HTTP. Perder el código degrada la precisión; hacer fallar la lectura perdería
 * además el error real del proveedor.
 */
export interface ProviderErrorDetail {
  /** Identificador del error, si el proveedor publicó uno utilizable. */
  readonly code: string | undefined;
  /** El cuerpo dice que se acabó el saldo, con independencia del estado HTTP. */
  readonly quotaExhausted: boolean;
}

export async function readErrorDetail(response: Response): Promise<ProviderErrorDetail> {
  const nothing: ProviderErrorDetail = { code: undefined, quotaExhausted: false };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return nothing;
  }
  if (typeof body !== 'object' || body === null) {
    return nothing;
  }
  const error: unknown = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) {
    return nothing;
  }
  const { code, type, message } = error as { code?: unknown; type?: unknown; message?: unknown };
  const candidate = typeof code === 'string' ? code : type;
  return {
    code: typeof candidate === 'string' && ERROR_CODE_SHAPE.test(candidate) ? candidate : undefined,
    quotaExhausted: saysQuotaExhausted(message),
  };
}

export function readRetryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (header === null) {
    return undefined;
  }
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined;
}
