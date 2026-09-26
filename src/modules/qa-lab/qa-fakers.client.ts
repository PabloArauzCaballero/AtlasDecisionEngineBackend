/**
 * Cliente de los fakers del servidor mock (`AtlasExternalProvidersMock`, `/mock/fakers`).
 *
 * Los datos de prueba realistas —nombres, carnets, celulares, ingresos— no se escriben en el
 * Motor: salen de un faker PARAMETRIZADO y determinista que comparten todos los portales. Aquí
 * sólo se piden y se valida la forma de la respuesta; qué se hace con ellos lo decide
 * `QaFakersService`.
 *
 * El cliente NUNCA inventa: si el mock no responde, lanza `FakerUnavailableError` con el
 * motivo en español, y quien llama sigue con el generador local y lo deja escrito.
 */
import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Lo que el mock acepta por petición; más se pide por páginas. */
export const FAKER_PAGE_SIZE = 200;

export const DEFAULT_FAKERS_BASE_URL = 'http://127.0.0.1:4010/mock';
const DEFAULT_TIMEOUT_MS = 4_000;

export class FakerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FakerUnavailableError';
  }
}

export interface FakerRequest {
  seed: string;
  count: number;
  params?: Record<string, unknown>;
}

export interface FakerResponse {
  items: Record<string, unknown>[];
  /** Versión del esquema que publica el mock: se archiva para poder reproducir. */
  schemaVersion?: string;
}

@Injectable()
export class QaFakersClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;

  constructor(@Optional() config?: ConfigService) {
    const configured = config?.get<string>('QA_FAKERS_BASE_URL');
    this.baseUrl = (configured ?? DEFAULT_FAKERS_BASE_URL).trim().replace(/\/+$/, '');
    this.timeoutMs = Number(config?.get<number>('QA_FAKERS_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS);
  }

  /**
   * `count` elementos del faker `type`. Por encima de 200 se piden páginas con semillas
   * derivadas (`semilla~1`, `semilla~2`…): el mock genera el elemento `i` a partir de
   * `(semilla, tipo, i)`, así que la misma semilla en dos páginas repetiría las mismas
   * personas.
   */
  async batch(type: string, request: FakerRequest): Promise<FakerResponse> {
    if (!this.baseUrl) {
      throw new FakerUnavailableError(
        'QA_FAKERS_BASE_URL está vacía: los fakers están desactivados en este despliegue.',
      );
    }
    const pages: FakerRequest[] = [];
    for (let offset = 0; offset < request.count; offset += FAKER_PAGE_SIZE) {
      const page = offset / FAKER_PAGE_SIZE;
      pages.push({
        seed: page === 0 ? request.seed : `${request.seed}~${page}`,
        count: Math.min(FAKER_PAGE_SIZE, request.count - offset),
        params: request.params,
      });
    }
    const results = await Promise.all(pages.map((page) => this.page(type, page)));
    return {
      items: results.flatMap((result) => result.items),
      schemaVersion: results[0]?.schemaVersion,
    };
  }

  private async page(type: string, request: FakerRequest): Promise<FakerResponse> {
    const url = `${this.baseUrl}/fakers/${encodeURIComponent(type)}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          seed: request.seed,
          count: request.count,
          variant: 'valido',
          params: request.params ?? {},
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new FakerUnavailableError(describeNetworkError(error, this.baseUrl, this.timeoutMs));
    }
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok) {
      const detail = typeof body?.detail === 'string' ? `: ${body.detail}` : '';
      throw new FakerUnavailableError(
        `El servidor de fakers respondió ${response.status} al pedir «${type}»${detail}`,
      );
    }
    const items = body?.items;
    if (
      !Array.isArray(items) ||
      items.length !== request.count ||
      items.some((item) => !item || typeof item !== 'object')
    ) {
      throw new FakerUnavailableError(
        `El servidor de fakers devolvió una respuesta inesperada para «${type}» (se esperaban ${request.count} elementos).`,
      );
    }
    return {
      items: items as Record<string, unknown>[],
      schemaVersion: typeof body?.schemaVersion === 'string' ? body.schemaVersion : undefined,
    };
  }
}

/**
 * Sin `instanceof`: el aborto por tiempo llega como `DOMException`, que no siempre es
 * `instanceof Error` (otro reino, p. ej. la VM de Jest), y el motivo se leería mal.
 */
function describeNetworkError(error: unknown, baseUrl: string, timeoutMs: number): string {
  const shape = (error ?? {}) as {
    name?: unknown;
    message?: unknown;
    cause?: { message?: unknown };
  };
  if (shape.name === 'TimeoutError' || shape.name === 'AbortError') {
    return `El servidor de fakers (${baseUrl}) no respondió en ${timeoutMs} ms.`;
  }
  const cause =
    typeof shape.cause?.message === 'string'
      ? shape.cause.message
      : typeof shape.message === 'string'
        ? shape.message
        : String(error);
  return `No se pudo conectar con el servidor de fakers (${baseUrl}): ${cause}`;
}
