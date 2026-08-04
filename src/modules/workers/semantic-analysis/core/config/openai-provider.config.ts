import { z } from 'zod';
import { OpenAiSemanticProviderOptions } from '../infrastructure/openai/openai-semantic.provider';

const environmentSchema = z.object({
  OPENAI_API_KEY: z.string().trim().min(1),
  OPENAI_BASE_URL: z.url().default('https://api.openai.com/v1'),
  SEMANTIC_FAST_MODEL: z.string().trim().min(1).default('gpt-4.1-mini'),
  SEMANTIC_DEEP_MODEL: z.string().trim().min(1).default('gpt-4.1'),
  SEMANTIC_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  SEMANTIC_PROVIDER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  SEMANTIC_PROVIDER_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(32_000).default(2_048),
});

/**
 * Construye las opciones del adaptador OpenAI a partir del entorno.
 *
 * La clave nunca se registra ni se propaga fuera de este objeto: es responsabilidad del gestor de
 * secretos del entorno hacerla llegar al proceso.
 */
export function loadOpenAiProviderOptions(
  environment: NodeJS.ProcessEnv = process.env,
): OpenAiSemanticProviderOptions {
  const parsed = environmentSchema.parse(environment);
  return {
    apiKey: parsed.OPENAI_API_KEY,
    baseUrl: parsed.OPENAI_BASE_URL,
    fastModel: parsed.SEMANTIC_FAST_MODEL,
    deepModel: parsed.SEMANTIC_DEEP_MODEL,
    timeoutMs: parsed.SEMANTIC_PROVIDER_TIMEOUT_MS,
    maxAttempts: parsed.SEMANTIC_PROVIDER_MAX_ATTEMPTS,
    maxOutputTokens: parsed.SEMANTIC_PROVIDER_MAX_OUTPUT_TOKENS,
  };
}

/**
 * Verifica que el presupuesto del proveedor quepa dentro del presupuesto del análisis.
 *
 * Sin esta comprobación una configuración aparentemente válida — dos tiers de 45 s dentro de un
 * job de 90 s — garantiza que el job expire y se reintente eternamente.
 */
export function assertProviderTimeoutFitsAnalysis(
  providerTimeoutMs: number,
  maxAttempts: number,
  analysisTimeoutSeconds: number,
): void {
  const tiers = 2;
  const worstCaseMs = providerTimeoutMs * maxAttempts * tiers;
  if (worstCaseMs > analysisTimeoutSeconds * 1_000) {
    throw new Error(
      `El peor caso del proveedor (${worstCaseMs} ms: ${String(maxAttempts)} intentos × ${String(tiers)} tiers) ` +
        `excede analysisTimeoutSeconds (${String(analysisTimeoutSeconds)} s). ` +
        'Reduzca SEMANTIC_PROVIDER_TIMEOUT_MS o SEMANTIC_PROVIDER_MAX_ATTEMPTS, o amplíe el presupuesto de análisis.',
    );
  }
}
