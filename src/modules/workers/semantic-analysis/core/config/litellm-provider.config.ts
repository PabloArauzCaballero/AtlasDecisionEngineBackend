import { z } from 'zod';
import { SemanticConfigurationError } from '../domain/semantic-analysis.errors';
import type { LiteLlmSemanticProviderOptions } from '../infrastructure/litellm/litellm-semantic.provider';

/**
 * Alias lógicos por omisión. Coinciden con los `model_name` de
 * `infra/litellm/config.yaml`: cambiar uno sin el otro deja el motor pidiendo un
 * despliegue que el gateway no conoce, y eso llega como un 400 permanente.
 */
export const DEFAULT_FAST_ALIAS = 'semantic-classifier-fast';
export const DEFAULT_DEEP_ALIAS = 'semantic-classifier-deep';
export const DEFAULT_EMBEDDING_ALIAS = 'semantic-embedding';

const environmentSchema = z.object({
  LITELLM_BASE_URL: z.url().default('http://litellm:4000/v1'),
  LITELLM_API_KEY: z.string().trim().min(1),
  LITELLM_FAST_MODEL: z.string().trim().min(1).default(DEFAULT_FAST_ALIAS),
  LITELLM_DEEP_MODEL: z.string().trim().min(1).default(DEFAULT_DEEP_ALIAS),
  LITELLM_EMBEDDING_MODEL: z.string().trim().min(1).default(DEFAULT_EMBEDDING_ALIAS),
  LITELLM_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  LITELLM_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  LITELLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(32_000).default(2_048),
});

/**
 * Nombres que delatan que alguien puso un modelo FÍSICO donde va un alias.
 *
 * No es purismo. El motor sólo puede cambiar de proveedor sin desplegar código
 * mientras lo que pide sea un nombre que el gateway resuelve; en cuanto pide
 * `gpt-4.1-mini`, ese nombre queda escrito en la configuración del motor, en la
 * etiqueta de sus métricas y en cada fila de auditoría, y mover el tráfico a otro
 * proveedor vuelve a ser un despliegue. El fallo es además silencioso: funciona
 * perfectamente el día que se configura.
 *
 * Quien de verdad quiera hablar directo con un modelo tiene la salida abierta y
 * declarada: `SEMANTIC_ANALYSIS_PROVIDER=openai` con `OPENAI_BASE_URL` apuntando
 * al gateway. Lo que no puede es hacerlo por accidente.
 */
const PHYSICAL_MODEL_SHAPE =
  /^(gpt-|o[1-4](-|$)|chatgpt-|claude-|gemini-|mistral-|llama-|command-|deepseek-|grok-)|^[a-z_]+\//iu;

function assertLogicalAlias(variable: string, alias: string): void {
  if (!PHYSICAL_MODEL_SHAPE.test(alias)) return;
  throw new SemanticConfigurationError(
    `${variable} debe nombrar un alias lógico del \`model_list\` de LiteLLM ` +
      '(por ejemplo `semantic-classifier-fast`), no un modelo físico ni un ' +
      '`proveedor/modelo`. El alias es lo que permite cambiar de proveedor sin ' +
      'desplegar el motor; si de verdad quiere fijar un modelo concreto, use ' +
      'SEMANTIC_ANALYSIS_PROVIDER=openai con OPENAI_BASE_URL apuntando al gateway.',
  );
}

/**
 * Construye las opciones del adaptador LiteLLM a partir del entorno.
 *
 * El proceso conoce ÚNICAMENTE la credencial del gateway: las claves de OpenAI,
 * Anthropic o Vertex viven en el contenedor de LiteLLM y nunca entran aquí. Esa
 * es la segunda razón de la integración, después de poder cambiar de proveedor:
 * reduce a una el número de secretos que el motor puede filtrar.
 */
export function loadLiteLlmProviderOptions(
  environment: NodeJS.ProcessEnv = process.env,
): LiteLlmSemanticProviderOptions {
  const parsed = environmentSchema.parse(environment);
  assertLogicalAlias('LITELLM_FAST_MODEL', parsed.LITELLM_FAST_MODEL);
  assertLogicalAlias('LITELLM_DEEP_MODEL', parsed.LITELLM_DEEP_MODEL);
  return {
    apiKey: parsed.LITELLM_API_KEY,
    baseUrl: parsed.LITELLM_BASE_URL,
    fastModel: parsed.LITELLM_FAST_MODEL,
    deepModel: parsed.LITELLM_DEEP_MODEL,
    timeoutMs: parsed.LITELLM_TIMEOUT_MS,
    maxAttempts: parsed.LITELLM_MAX_ATTEMPTS,
    maxOutputTokens: parsed.LITELLM_MAX_OUTPUT_TOKENS,
  };
}

/** Alias y credencial para los embeddings del recuperador híbrido, si se usan. */
export function loadLiteLlmEmbeddingOptions(environment: NodeJS.ProcessEnv = process.env): {
  apiKey: string;
  baseUrl: string;
  model: string;
} {
  const parsed = environmentSchema.parse(environment);
  assertLogicalAlias('LITELLM_EMBEDDING_MODEL', parsed.LITELLM_EMBEDDING_MODEL);
  return {
    apiKey: parsed.LITELLM_API_KEY,
    baseUrl: parsed.LITELLM_BASE_URL,
    model: parsed.LITELLM_EMBEDDING_MODEL,
  };
}
