import { z } from 'zod';
import { EmbeddingProvider, SemanticModelProvider } from '../application/ports';
import { SemanticWorkerConfig } from './semantic-worker.config';
import {
  assertProviderTimeoutFitsAnalysis,
  loadOpenAiProviderOptions,
} from './openai-provider.config';
import { loadOllamaEmbeddingOptions, loadOllamaProviderOptions } from './ollama-provider.config';
import { OpenAiSemanticProvider } from '../infrastructure/openai/openai-semantic.provider';
import { OpenAiEmbeddingProvider } from '../infrastructure/openai/openai-embedding.provider';
import { OllamaSemanticProvider } from '../infrastructure/ollama/ollama-semantic.provider';
import { OllamaEmbeddingProvider } from '../infrastructure/ollama/ollama-embedding.provider';

const selectionSchema = z.object({
  SEMANTIC_MODEL_PROVIDER: z.enum(['openai', 'ollama']).default('openai'),
  // Se resuelve por separado para permitir la adopción por etapas: embeddings locales sobre un
  // clasificador alojado es una configuración deliberada, no una inconsistencia.
  SEMANTIC_EMBEDDING_PROVIDER: z.enum(['openai', 'ollama']).optional(),
});

export interface ResolvedModelProviders {
  readonly modelProvider: SemanticModelProvider;
  /** Ausente fuera del modo híbrido: exigir credenciales o un modelo descargado a quien nunca va a
   *  usar embeddings convertiría una función opcional en un requisito de arranque. */
  readonly embeddingProvider?: EmbeddingProvider;
}

/**
 * Resuelve los adaptadores de modelo declarados en el entorno.
 *
 * Concentra aquí la selección para que el árbol de módulos no conozca proveedores concretos y para
 * que la comprobación del presupuesto de tiempo se aplique al proveedor realmente elegido: es
 * precisamente al pasar a un modelo local —mucho más lento— cuando esa comprobación importa.
 */
export function loadModelProviders(
  environment: NodeJS.ProcessEnv,
  config: SemanticWorkerConfig,
): ResolvedModelProviders {
  const selection = selectionSchema.parse(environment);
  const embeddingKind = selection.SEMANTIC_EMBEDDING_PROVIDER ?? selection.SEMANTIC_MODEL_PROVIDER;
  const wantsEmbeddings = config.retrievalMode === 'hybrid';

  const modelProvider =
    selection.SEMANTIC_MODEL_PROVIDER === 'ollama'
      ? buildOllamaModelProvider(environment, config)
      : buildOpenAiModelProvider(environment, config);

  if (!wantsEmbeddings) {
    return { modelProvider };
  }
  return {
    modelProvider,
    embeddingProvider:
      embeddingKind === 'ollama'
        ? new OllamaEmbeddingProvider(loadOllamaEmbeddingOptions(environment))
        : buildOpenAiEmbeddingProvider(environment),
  };
}

function buildOllamaModelProvider(
  environment: NodeJS.ProcessEnv,
  config: SemanticWorkerConfig,
): SemanticModelProvider {
  const options = loadOllamaProviderOptions(environment);
  assertProviderTimeoutFitsAnalysis(
    options.timeoutMs ?? 30_000,
    options.maxAttempts ?? 2,
    config.analysisTimeoutSeconds,
  );
  return new OllamaSemanticProvider(options);
}

function buildOpenAiModelProvider(
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

function buildOpenAiEmbeddingProvider(environment: NodeJS.ProcessEnv): EmbeddingProvider {
  const options = loadOpenAiProviderOptions(environment);
  return new OpenAiEmbeddingProvider({
    apiKey: options.apiKey,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    model: environment['SEMANTIC_EMBEDDING_MODEL'] ?? 'text-embedding-3-small',
  });
}
