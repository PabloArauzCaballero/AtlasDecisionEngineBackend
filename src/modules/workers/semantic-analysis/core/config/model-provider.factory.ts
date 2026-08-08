import { z } from 'zod';
import { EmbeddingProvider, SemanticModelProvider } from '../application/ports';
import { SemanticWorkerConfig } from './semantic-worker.config';
import {
  assertProviderTimeoutFitsAnalysis,
  loadOpenAiProviderOptions,
} from './openai-provider.config';
import { loadTransformerProviderOptions } from './transformer-provider.config';
import { OpenAiSemanticProvider } from '../infrastructure/openai/openai-semantic.provider';
import { OpenAiEmbeddingProvider } from '../infrastructure/openai/openai-embedding.provider';
import { TransformerSemanticProvider } from '../infrastructure/transformer/transformer-semantic.provider';
import { TransformerEmbeddingProvider } from '../infrastructure/transformer/transformer-embedding.provider';

const selectionSchema = z.object({
  SEMANTIC_MODEL_PROVIDER: z.enum(['openai', 'transformer']).default('openai'),
  // Se resuelve por separado para permitir la adopción por etapas: embeddings locales sobre un
  // clasificador alojado es una configuración deliberada, no una inconsistencia.
  SEMANTIC_EMBEDDING_PROVIDER: z.enum(['openai', 'transformer']).optional(),
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
 * que la comprobación del presupuesto de tiempo se aplique al proveedor realmente elegido.
 *
 * El adaptador de transformers no pasa por esa comprobación, y no es un olvido: no reintenta —el
 * clasificador hace UNA llamada por nivel—, de modo que su peor caso es su propio timeout, un orden
 * de magnitud por debajo del presupuesto de cualquier análisis. La comprobación existe para el
 * proveedor generativo, cuyo peor caso se multiplica por los intentos.
 */
export function loadModelProviders(
  environment: NodeJS.ProcessEnv,
  config: SemanticWorkerConfig,
): ResolvedModelProviders {
  const selection = selectionSchema.parse(environment);
  const embeddingKind = selection.SEMANTIC_EMBEDDING_PROVIDER ?? selection.SEMANTIC_MODEL_PROVIDER;
  const wantsEmbeddings = config.retrievalMode === 'hybrid';

  const modelProvider =
    selection.SEMANTIC_MODEL_PROVIDER === 'transformer'
      ? buildTransformerModelProvider(environment)
      : buildOpenAiModelProvider(environment, config);

  if (!wantsEmbeddings) {
    return { modelProvider };
  }
  return {
    modelProvider,
    embeddingProvider:
      embeddingKind === 'transformer'
        ? buildTransformerEmbeddingProvider(environment)
        : buildOpenAiEmbeddingProvider(environment),
  };
}

/**
 * El clasificador y el recuperador híbrido comparten adaptador de embeddings pero NO instancia:
 * cada uno se construye con su propia configuración de lote y su propio cliente. Compartir la
 * instancia acoplaría el presupuesto de tiempo de la recuperación con el de la clasificación, que
 * son distintos y se agotan por separado.
 */
function buildTransformerModelProvider(environment: NodeJS.ProcessEnv): SemanticModelProvider {
  const options = loadTransformerProviderOptions(environment);
  return new TransformerSemanticProvider({
    embeddings: new TransformerEmbeddingProvider(options.embedding),
    queryPrefix: options.queryPrefix,
    passagePrefix: options.passagePrefix,
    ...options.thresholds,
  });
}

function buildTransformerEmbeddingProvider(environment: NodeJS.ProcessEnv): EmbeddingProvider {
  return new TransformerEmbeddingProvider(loadTransformerProviderOptions(environment).embedding);
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
