import { EmbeddingProvider, SemanticModelProvider } from '../../application/ports';
import { SemanticWorkerConfig } from '../semantic-worker.config';
import {
  assertProviderTimeoutFitsAnalysis,
  loadOpenAiProviderOptions,
} from '../openai-provider.config';
import { loadTransformerProviderOptions } from '../transformer-provider.config';
import {
  loadLiteLlmEmbeddingOptions,
  loadLiteLlmProviderOptions,
} from '../litellm-provider.config';
import { loadOpenRouterProviderOptions } from '../openrouter-provider.config';
import { OpenAiSemanticProvider } from '../../infrastructure/openai/openai-semantic.provider';
import { OpenAiEmbeddingProvider } from '../../infrastructure/openai/openai-embedding.provider';
import { TransformerSemanticProvider } from '../../infrastructure/transformer/transformer-semantic.provider';
import { TransformerEmbeddingProvider } from '../../infrastructure/transformer/transformer-embedding.provider';
import { LiteLlmSemanticProvider } from '../../infrastructure/litellm/litellm-semantic.provider';
import { OpenRouterSemanticProvider } from '../../infrastructure/openrouter/openrouter-semantic.provider';

/**
 * El clasificador y el recuperador híbrido comparten adaptador de embeddings pero NO instancia:
 * cada uno se construye con su propia configuración de lote y su propio cliente. Compartir la
 * instancia acoplaría el presupuesto de tiempo de la recuperación con el de la clasificación, que
 * son distintos y se agotan por separado.
 */
export function buildTransformerModelProvider(
  environment: NodeJS.ProcessEnv,
): SemanticModelProvider {
  const options = loadTransformerProviderOptions(environment);
  return new TransformerSemanticProvider({
    embeddings: new TransformerEmbeddingProvider(options.embedding),
    queryPrefix: options.queryPrefix,
    passagePrefix: options.passagePrefix,
    probeCacheSize: options.probeCacheSize,
    ...options.thresholds,
  });
}

export function buildTransformerEmbeddingProvider(
  environment: NodeJS.ProcessEnv,
): EmbeddingProvider {
  return new TransformerEmbeddingProvider(loadTransformerProviderOptions(environment).embedding);
}

export function buildOpenAiModelProvider(
  environment: NodeJS.ProcessEnv,
  config: SemanticWorkerConfig,
): SemanticModelProvider {
  const options = loadOpenAiProviderOptions(environment);
  assertProviderTimeoutFitsAnalysis(
    options.timeoutMs ?? 30_000,
    options.maxAttempts ?? 3,
    config.analysisTimeoutSeconds,
  );
  return new OpenAiSemanticProvider(options);
}

/**
 * El gateway se comprueba contra el presupuesto igual que el proveedor generativo directo: sus
 * reintentos tampoco ven el reloj del análisis, y encima el gateway puede sumar los suyos
 * propios por debajo. El peor caso que se calcula aquí es por tanto un SUELO, no un techo;
 * `num_retries` en `config.yaml` es la otra mitad de la cuenta y debe mantenerse en 0 o 1.
 */
export function buildLiteLlmModelProvider(
  environment: NodeJS.ProcessEnv,
  config: SemanticWorkerConfig,
): SemanticModelProvider {
  const options = loadLiteLlmProviderOptions(environment);
  assertProviderTimeoutFitsAnalysis(
    options.timeoutMs ?? 30_000,
    options.maxAttempts ?? 3,
    config.analysisTimeoutSeconds,
  );
  return new LiteLlmSemanticProvider(options);
}

/**
 * OpenRouter se comprueba contra el presupuesto exactamente igual que el gateway propio:
 * sus reintentos tampoco ven el reloj del análisis. Aquí no hay `num_retries` por debajo
 * que sumar, pero sí un enrutado entre proveedores físicos que puede probar más de uno
 * dentro de la misma llamada, así que el peor caso sigue siendo un SUELO.
 */
export function buildOpenRouterModelProvider(
  environment: NodeJS.ProcessEnv,
  config: SemanticWorkerConfig,
): SemanticModelProvider {
  const options = loadOpenRouterProviderOptions(environment);
  assertProviderTimeoutFitsAnalysis(
    options.timeoutMs ?? 30_000,
    options.maxAttempts ?? 3,
    config.analysisTimeoutSeconds,
  );
  return new OpenRouterSemanticProvider(options);
}

/**
 * Los embeddings del recuperador híbrido también pasan por el gateway.
 *
 * Reutiliza el adaptador de OpenAI porque `/embeddings` de LiteLLM ES la interfaz de OpenAI:
 * escribir un segundo cliente idéntico sólo añadiría un sitio más donde el lote o el plazo
 * pueden divergir. Lo que cambia es el alias y la credencial, que es justo lo que se le pasa.
 */
export function buildLiteLlmEmbeddingProvider(environment: NodeJS.ProcessEnv): EmbeddingProvider {
  const options = loadLiteLlmEmbeddingOptions(environment);
  return new OpenAiEmbeddingProvider(options);
}

export function buildOpenAiEmbeddingProvider(environment: NodeJS.ProcessEnv): EmbeddingProvider {
  const options = loadOpenAiProviderOptions(environment);
  return new OpenAiEmbeddingProvider({
    apiKey: options.apiKey,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    model: environment['SEMANTIC_EMBEDDING_MODEL'] ?? 'text-embedding-3-small',
  });
}
