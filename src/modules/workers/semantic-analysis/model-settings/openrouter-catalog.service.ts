import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../../../common/errors/domain-exception';
import {
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_OPENROUTER_DEEP_MODEL,
  DEFAULT_OPENROUTER_FAST_MODEL,
} from '../core/config/openrouter-provider.config';
import { normalizeBaseUrl } from '../core/infrastructure/http/openai-compatible-transport';
import type { OpenRouterCatalogDto, OpenRouterModelDto } from './semantic-model-settings.dto';

/** Diez minutos: el catálogo cambia a diario, no por segundo, y la pantalla lo pide en cada visita. */
const CATALOG_TTL_MS = 10 * 60 * 1_000;
const CATALOG_TIMEOUT_MS = 15_000;

interface OpenRouterModelRecord {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly context_length?: unknown;
  readonly supported_parameters?: unknown;
  readonly pricing?: { readonly prompt?: unknown; readonly completion?: unknown };
}

/**
 * El catálogo público de OpenRouter, filtrado a lo que este worker puede usar.
 *
 * Sólo se ofrecen los modelos que declaran `structured_outputs` y
 * `response_format`. No es una preferencia: el adaptador pide un esquema JSON
 * estricto con `require_parameters`, y un modelo sin esa capacidad devuelve un
 * 400 permanente en CADA glosa. Dejar elegirlo desde el portal sería ofrecer
 * un botón que llena la bandeja de revisión.
 *
 * Los precios se publican por millón de tokens porque es como los lee una
 * persona; OpenRouter los da por token, con siete ceros delante.
 */
@Injectable()
export class OpenRouterCatalogService {
  private readonly logger = new Logger(OpenRouterCatalogService.name);
  private cached: { readonly value: OpenRouterCatalogDto; readonly readAt: number } | undefined;
  // Propiedad y no parámetro del constructor: Nest intentaría inyectar `fetch`
  // como si fuera un proveedor y el módulo no arrancaría.
  private readonly fetchImplementation: typeof fetch = fetch;

  constructor(private readonly config: ConfigService) {}

  async list(): Promise<OpenRouterCatalogDto> {
    if (this.cached !== undefined && Date.now() - this.cached.readAt < CATALOG_TTL_MS) {
      return this.cached.value;
    }
    const value = await this.fetchCatalog();
    this.cached = { value, readAt: Date.now() };
    return value;
  }

  private async fetchCatalog(): Promise<OpenRouterCatalogDto> {
    const baseUrl = normalizeBaseUrl(
      this.config.get<string>('OPENROUTER_BASE_URL') ?? DEFAULT_OPENROUTER_BASE_URL,
    );
    // La credencial no hace falta para leer el catálogo; se manda si está para
    // que la cuota de lectura se cuente contra la cuenta y no contra la IP.
    const apiKey = (this.config.get<string>('OPENROUTER_API_KEY') ?? '').trim();
    let response: Response;
    try {
      response = await this.fetchImplementation(`${baseUrl}/models`, {
        method: 'GET',
        headers: apiKey.length > 0 ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo leer el catálogo de OpenRouter: ${String(error instanceof Error ? error.message : error)}`,
      );
      throw unavailable();
    }
    if (!response.ok) throw unavailable(response.status);

    const body = (await response.json()) as { data?: unknown };
    const records = Array.isArray(body.data) ? (body.data as OpenRouterModelRecord[]) : [];
    const models = records
      .map((record) => toModel(record))
      .filter((model): model is OpenRouterModelDto => model !== null)
      .sort((a, b) => a.id.localeCompare(b.id));
    return { models, fetchedAt: new Date().toISOString() };
  }
}

function toModel(record: OpenRouterModelRecord): OpenRouterModelDto | null {
  if (typeof record.id !== 'string' || record.id.length === 0) return null;
  const parameters = Array.isArray(record.supported_parameters)
    ? (record.supported_parameters as unknown[])
    : [];
  if (!parameters.includes('structured_outputs') || !parameters.includes('response_format')) {
    return null;
  }
  return {
    id: record.id,
    name: typeof record.name === 'string' ? record.name : record.id,
    contextLength: typeof record.context_length === 'number' ? record.context_length : 0,
    promptUsdPerMillion: perMillion(record.pricing?.prompt),
    completionUsdPerMillion: perMillion(record.pricing?.completion),
    recommended:
      record.id === DEFAULT_OPENROUTER_FAST_MODEL || record.id === DEFAULT_OPENROUTER_DEEP_MODEL,
  };
}

function perMillion(perToken: unknown): number {
  const value = Number(perToken);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 1_000_000 * 10_000) / 10_000;
}

function unavailable(status?: number): DomainException {
  return new DomainException(
    'OPENROUTER_CATALOG_UNAVAILABLE',
    'No se pudo leer el catálogo de modelos de OpenRouter. Vuelve a intentarlo; si persiste, el motor no alcanza openrouter.ai.',
    HttpStatus.BAD_GATEWAY,
    status === undefined ? undefined : { status },
  );
}
