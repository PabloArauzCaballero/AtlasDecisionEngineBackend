import { EmbeddingProvider, SemanticModelProvider } from '../../application/ports';
import { SemanticWorkerConfig } from '../semantic-worker.config';
import { SemanticConfigurationError } from '../../domain/semantic-analysis.errors';
import { CascadingSemanticProvider } from '../../infrastructure/cascade/cascading-semantic.provider';
import {
  buildLiteLlmEmbeddingProvider,
  buildLiteLlmModelProvider,
  buildOpenAiEmbeddingProvider,
  buildOpenAiModelProvider,
  buildOpenRouterModelProvider,
  buildTransformerEmbeddingProvider,
  buildTransformerModelProvider,
} from './builders';
import { RemoteGatewayKind, assertTransferAllowed, selectionSchema } from './selection';

export type ProviderKind = 'openai' | 'transformer' | 'litellm' | 'openrouter' | 'cascade';

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
 * El adaptador de transformers no pasa por esa comprobación, y no es un olvido: su peor caso —tres
 * intentos de 15 s con sus esperas— sigue por debajo del presupuesto por defecto del análisis, y
 * además cada intento comparte el `AbortSignal` de ese presupuesto, así que no puede rebasarlo por
 * mucho que se suban los intentos. La comprobación existe para el proveedor generativo, cuyos
 * reintentos no ven el presupuesto y por eso hay que sumarlos a mano.
 */
export function loadModelProviders(
  environment: NodeJS.ProcessEnv,
  config: SemanticWorkerConfig,
): ResolvedModelProviders {
  const selection = selectionSchema.parse(environment);
  const embeddingKind = selection.SEMANTIC_EMBEDDING_PROVIDER ?? selection.SEMANTIC_MODEL_PROVIDER;
  const wantsEmbeddings = config.retrievalMode === 'hybrid';

  // Los dos adaptadores se comprueban por separado: la configuración por etapas permite un
  // clasificador local con embeddings alojados, y ese también transfiere el texto.
  assertTransferAllowed(selection.SEMANTIC_MODEL_PROVIDER, selection);
  if (wantsEmbeddings) assertTransferAllowed(embeddingKind, selection);

  const modelProvider = buildModelProvider(selection.SEMANTIC_MODEL_PROVIDER, environment, config);

  if (!wantsEmbeddings) {
    return { modelProvider };
  }
  return { modelProvider, embeddingProvider: buildEmbeddingProvider(embeddingKind, environment) };
}

function buildModelProvider(
  kind: ProviderKind,
  environment: NodeJS.ProcessEnv,
  config: SemanticWorkerConfig,
): SemanticModelProvider {
  if (kind === 'transformer') return buildTransformerModelProvider(environment);
  if (kind === 'litellm') return buildLiteLlmModelProvider(environment, config);
  if (kind === 'openrouter') return buildOpenRouterModelProvider(environment, config);
  if (kind === 'cascade') return buildCascadeModelProvider(environment, config);
  return buildOpenAiModelProvider(environment, config);
}

/**
 * Local primero, LLM sólo si aquél no puede o tarda demasiado.
 *
 * Los dos adaptadores se construyen aquí y no dentro del compuesto para que ÉSTE no
 * conozca proveedores concretos: recibe dos puertos y no sabe que uno habla con un
 * servidor de embeddings y el otro con un gateway. Cambiar cualquiera de los dos no
 * toca la lógica de la cascada — y por eso el escalón remoto puede ser cualquiera
 * de los dos gateways sin que la cascada se entere.
 */
function buildCascadeModelProvider(
  environment: NodeJS.ProcessEnv,
  config: SemanticWorkerConfig,
): SemanticModelProvider {
  const {
    SEMANTIC_CASCADE_LOCAL_TIMEOUT_MS: localTimeoutMs,
    SEMANTIC_CASCADE_REMOTE_PROVIDER: remoteKind,
  } = selectionSchema.parse(environment);
  return new CascadingSemanticProvider({
    local: buildTransformerModelProvider(environment),
    remote: buildRemoteGatewayProvider(remoteKind, environment, config),
    localTimeoutMs,
  });
}

/**
 * El escalón remoto, sea el gateway propio o el alojado. Público porque la
 * configuración en tiempo de ejecución elige entre los dos sin pasar por el
 * entorno, y necesita construir exactamente lo mismo que construiría éste.
 */
export function buildRemoteGatewayProvider(
  kind: RemoteGatewayKind,
  environment: NodeJS.ProcessEnv,
  config: SemanticWorkerConfig,
): SemanticModelProvider {
  return kind === 'openrouter'
    ? buildOpenRouterModelProvider(environment, config)
    : buildLiteLlmModelProvider(environment, config);
}

function buildEmbeddingProvider(
  kind: ProviderKind,
  environment: NodeJS.ProcessEnv,
): EmbeddingProvider {
  // `cascade` recupera candidatas con el codificador LOCAL, por coherencia con su
  // propia tesis: la recuperación se ejecuta en TODAS las glosas, así que pagarla
  // por embeddings remotos anularía el ahorro que justifica la cascada.
  if (kind === 'transformer' || kind === 'cascade')
    return buildTransformerEmbeddingProvider(environment);
  if (kind === 'litellm') return buildLiteLlmEmbeddingProvider(environment);
  // OpenRouter no publica `/embeddings` con el contrato de OpenAI. Heredar el
  // proveedor de clasificación aquí construiría un cliente que falla en la
  // primera recuperación; mejor pedir la decisión explícita.
  if (kind === 'openrouter') {
    throw new SemanticConfigurationError(
      'OpenRouter no ofrece embeddings: con SEMANTIC_ANALYSIS_PROVIDER=openrouter y el ' +
        'recuperador híbrido hay que declarar SEMANTIC_EMBEDDING_PROVIDER (transformer | litellm | openai).',
    );
  }
  return buildOpenAiEmbeddingProvider(environment);
}
