import { z } from 'zod';
import { OllamaSemanticProviderOptions } from '../infrastructure/ollama/ollama-semantic.provider';
import { OllamaEmbeddingProviderOptions } from '../infrastructure/ollama/ollama-embedding.provider';

const booleanFlag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

const environmentSchema = z.object({
  OLLAMA_BASE_URL: z.url().default('http://127.0.0.1:11434'),
  OLLAMA_API_KEY: z.string().trim().min(1).optional(),
  SEMANTIC_FAST_MODEL: z.string().trim().min(1).default('qwen3:8b'),
  SEMANTIC_DEEP_MODEL: z.string().trim().min(1).default('qwen3:14b'),
  // Por defecto más alto que en OpenAI: la generación local no compite con una API alojada, y un
  // presupuesto ajustado sólo produce timeouts que se reintentan hasta agotar el job.
  SEMANTIC_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  SEMANTIC_PROVIDER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(2),
  SEMANTIC_PROVIDER_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(32_000).default(1_536),
  // El valor por defecto de Ollama (4096) trunca el prompt en silencio con el catálogo completo de
  // candidatos, y un texto truncado se clasifica mal sin que nada lo señale.
  SEMANTIC_OLLAMA_CONTEXT_TOKENS: z.coerce.number().int().min(2_048).max(131_072).default(8_192),
  SEMANTIC_OLLAMA_KEEP_ALIVE: z.string().trim().min(1).default('30m'),
  SEMANTIC_OLLAMA_THINK: booleanFlag,
  SEMANTIC_OLLAMA_SEED: z.coerce.number().int().optional(),
  SEMANTIC_EMBEDDING_MODEL: z.string().trim().min(1).default('bge-m3'),
  SEMANTIC_OLLAMA_EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(512).default(32),
});

/**
 * Construye las opciones del adaptador de Ollama a partir del entorno.
 *
 * Reutiliza `SEMANTIC_FAST_MODEL` y `SEMANTIC_DEEP_MODEL` en lugar de introducir claves paralelas:
 * los tiers son una decisión del dominio, no del proveedor, y así cambiar de proveedor no obliga a
 * reescribir el resto de la configuración.
 */
export function loadOllamaProviderOptions(
  environment: NodeJS.ProcessEnv = process.env,
): OllamaSemanticProviderOptions {
  const parsed = environmentSchema.parse(environment);
  return {
    baseUrl: parsed.OLLAMA_BASE_URL,
    ...(parsed.OLLAMA_API_KEY === undefined ? {} : { apiKey: parsed.OLLAMA_API_KEY }),
    fastModel: parsed.SEMANTIC_FAST_MODEL,
    deepModel: parsed.SEMANTIC_DEEP_MODEL,
    timeoutMs: parsed.SEMANTIC_PROVIDER_TIMEOUT_MS,
    maxAttempts: parsed.SEMANTIC_PROVIDER_MAX_ATTEMPTS,
    maxOutputTokens: parsed.SEMANTIC_PROVIDER_MAX_OUTPUT_TOKENS,
    contextTokens: parsed.SEMANTIC_OLLAMA_CONTEXT_TOKENS,
    keepAlive: parsed.SEMANTIC_OLLAMA_KEEP_ALIVE,
    ...(parsed.SEMANTIC_OLLAMA_THINK === undefined ? {} : { think: parsed.SEMANTIC_OLLAMA_THINK }),
    ...(parsed.SEMANTIC_OLLAMA_SEED === undefined ? {} : { seed: parsed.SEMANTIC_OLLAMA_SEED }),
  };
}

export function loadOllamaEmbeddingOptions(
  environment: NodeJS.ProcessEnv = process.env,
): OllamaEmbeddingProviderOptions {
  const parsed = environmentSchema.parse(environment);
  return {
    baseUrl: parsed.OLLAMA_BASE_URL,
    ...(parsed.OLLAMA_API_KEY === undefined ? {} : { apiKey: parsed.OLLAMA_API_KEY }),
    model: parsed.SEMANTIC_EMBEDDING_MODEL,
    keepAlive: parsed.SEMANTIC_OLLAMA_KEEP_ALIVE,
    batchSize: parsed.SEMANTIC_OLLAMA_EMBEDDING_BATCH_SIZE,
  };
}
