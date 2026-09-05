import { z } from 'zod';
import { SemanticConfigurationError } from '../domain/semantic-analysis.errors';
import type { OpenRouterSemanticProviderOptions } from '../infrastructure/openrouter/openrouter-semantic.provider';

/**
 * Modelos por omisión. Los dos declaran `structured_outputs` en el catálogo de
 * OpenRouter, que es la única propiedad que este worker no puede negociar: sin
 * ella la salida no respeta el esquema y cada glosa acaba en revisión humana.
 *
 * El rápido es el más barato de los que sostienen salida estructurada con
 * fiabilidad; el profundo sólo entra en lo que el rápido dejó ambiguo, así que
 * su precio se paga pocas veces.
 */
export const DEFAULT_OPENROUTER_FAST_MODEL = 'openai/gpt-4.1-mini';
export const DEFAULT_OPENROUTER_DEEP_MODEL = 'anthropic/claude-sonnet-4.5';
export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const environmentSchema = z.object({
  OPENROUTER_BASE_URL: z.url().default(DEFAULT_OPENROUTER_BASE_URL),
  OPENROUTER_API_KEY: z.string().trim().min(1),
  OPENROUTER_FAST_MODEL: z.string().trim().min(1).default(DEFAULT_OPENROUTER_FAST_MODEL),
  OPENROUTER_DEEP_MODEL: z.string().trim().min(1).default(DEFAULT_OPENROUTER_DEEP_MODEL),
  OPENROUTER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  OPENROUTER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  OPENROUTER_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(32_000).default(2_048),
  /** Atribución opcional (`HTTP-Referer` / `X-Title`). OpenRouter la usa para su ranking público. */
  OPENROUTER_APP_URL: z.url().optional(),
  OPENROUTER_APP_TITLE: z.string().trim().min(1).max(80).optional(),
});

/**
 * Forma de un identificador de modelo de OpenRouter: `proveedor/modelo`, con
 * variante opcional (`:free`, `:nitro`, `:floor`).
 *
 * Es exactamente la forma que `litellm-provider.config` RECHAZA, y no es una
 * contradicción: cada adaptador exige lo que su gateway resuelve. LiteLLM
 * resuelve alias que él mismo traduce, así que pedirle un modelo físico ata al
 * motor a un proveedor. OpenRouter resuelve identificadores físicos y no tiene
 * alias que ofrecer: pedirle otra cosa es un 400 permanente.
 */
export const OPENROUTER_MODEL_SHAPE =
  /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*(?::[a-z0-9-]+)?$/iu;

export function assertOpenRouterModelId(variable: string, model: string): void {
  if (OPENROUTER_MODEL_SHAPE.test(model)) return;
  throw new SemanticConfigurationError(
    `${variable} debe ser un identificador de modelo de OpenRouter con la forma ` +
      '`proveedor/modelo` (por ejemplo `openai/gpt-4.1-mini`). OpenRouter no resuelve ' +
      'alias: el modelo físico es lo que se le pide.',
  );
}

/**
 * Construye las opciones del adaptador de OpenRouter a partir del entorno.
 *
 * Igual que con LiteLLM, el proceso conoce UNA credencial: la de OpenRouter.
 * Las cuentas de OpenAI, Anthropic o Google viven en OpenRouter, no aquí. Lo
 * que cambia respecto al gateway propio es quién decide el modelo: aquí lo
 * decide el motor, y por eso el identificador es físico y se valida como tal.
 */
export function loadOpenRouterProviderOptions(
  environment: NodeJS.ProcessEnv = process.env,
): OpenRouterSemanticProviderOptions {
  const parsed = environmentSchema.parse(environment);
  assertOpenRouterModelId('OPENROUTER_FAST_MODEL', parsed.OPENROUTER_FAST_MODEL);
  assertOpenRouterModelId('OPENROUTER_DEEP_MODEL', parsed.OPENROUTER_DEEP_MODEL);
  return {
    apiKey: parsed.OPENROUTER_API_KEY,
    baseUrl: parsed.OPENROUTER_BASE_URL,
    fastModel: parsed.OPENROUTER_FAST_MODEL,
    deepModel: parsed.OPENROUTER_DEEP_MODEL,
    timeoutMs: parsed.OPENROUTER_TIMEOUT_MS,
    maxAttempts: parsed.OPENROUTER_MAX_ATTEMPTS,
    maxOutputTokens: parsed.OPENROUTER_MAX_OUTPUT_TOKENS,
    ...(parsed.OPENROUTER_APP_URL === undefined ? {} : { appUrl: parsed.OPENROUTER_APP_URL }),
    ...(parsed.OPENROUTER_APP_TITLE === undefined ? {} : { appTitle: parsed.OPENROUTER_APP_TITLE }),
  };
}
