import { z } from 'zod';
import { EmbeddingProvider, SemanticModelProvider } from '../application/ports';
import { SemanticWorkerConfig } from './semantic-worker.config';
import {
  assertProviderTimeoutFitsAnalysis,
  loadOpenAiProviderOptions,
} from './openai-provider.config';
import { loadTransformerProviderOptions } from './transformer-provider.config';
import { loadLiteLlmEmbeddingOptions, loadLiteLlmProviderOptions } from './litellm-provider.config';
import { loadOpenRouterProviderOptions } from './openrouter-provider.config';
import { SemanticConfigurationError } from '../domain/semantic-analysis.errors';
import { OpenAiSemanticProvider } from '../infrastructure/openai/openai-semantic.provider';
import { OpenAiEmbeddingProvider } from '../infrastructure/openai/openai-embedding.provider';
import { TransformerSemanticProvider } from '../infrastructure/transformer/transformer-semantic.provider';
import { TransformerEmbeddingProvider } from '../infrastructure/transformer/transformer-embedding.provider';
import { LiteLlmSemanticProvider } from '../infrastructure/litellm/litellm-semantic.provider';
import { OpenRouterSemanticProvider } from '../infrastructure/openrouter/openrouter-semantic.provider';
import { CascadingSemanticProvider } from '../infrastructure/cascade/cascading-semantic.provider';

/** Los dos gateways que pueden atender el escalón remoto: el propio y el alojado. */
export type RemoteGatewayKind = 'litellm' | 'openrouter';

const selectionSchema = z.object({
  SEMANTIC_MODEL_PROVIDER: z
    .enum(['openai', 'transformer', 'litellm', 'openrouter', 'cascade'])
    .default('openai'),
  /**
   * Quién atiende el escalón remoto de la cascada. Por omisión el gateway
   * propio, que es lo que había; `openrouter` deja el codificador local
   * exactamente igual y sólo cambia a quién se le pregunta lo difícil.
   */
  SEMANTIC_CASCADE_REMOTE_PROVIDER: z.enum(['litellm', 'openrouter']).default('litellm'),
  /**
   * Cuánto se le espera al clasificador local antes de escalar al modelo remoto.
   *
   * Dos segundos porque un codificador local resuelve en decenas de milisegundos:
   * pasar de ahí no significa «va a tardar un poco más», significa que algo va mal
   * —el servidor de embeddings caído, el modelo recargándose, la CPU saturada— y
   * seguir esperando sólo retrasa una respuesta que el escalón siguiente puede dar.
   */
  SEMANTIC_CASCADE_LOCAL_TIMEOUT_MS: z.coerce.number().int().min(200).max(60_000).default(2_000),
  // Se resuelve por separado para permitir la adopción por etapas: embeddings locales sobre un
  // clasificador alojado es una configuración deliberada, no una inconsistencia.
  SEMANTIC_EMBEDDING_PROVIDER: z.enum(['openai', 'transformer', 'litellm']).optional(),
  NODE_ENV: z.string().optional(),
  SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER: z
    .string()
    .optional()
    .transform((value) => value === 'true' || value === '1' || value === 'yes'),
});

/**
 * Comprueba, ya con el proveedor elegido en la mano, que nadie transfiere datos al exterior
 * sin haberlo decidido.
 *
 * Duplica la validación del env schema a propósito, igual que `ScriptNodeRunnerService`
 * duplica la del runner: el schema protege el arranque del proceso, y esto protege el punto
 * donde de verdad se construye el cliente que va a salir a internet. Si alguien monta este
 * módulo por otra vía —una prueba, un script, un arranque que se saltó la validación—, la
 * decisión sigue siendo explícita.
 *
 * `openai` envía a `api.openai.com` el texto que clasifica, que procede de extractos y
 * descripciones de movimientos: dato personal cruzando la frontera. LGPD art. 33 y, para una
 * institución financiera brasileña, Res. BACEN 4.658 arts. 11-15.
 *
 * **`litellm` cuenta igual, y el gateway propio no es la excepción que parece.** El proxy
 * corre dentro del perímetro, pero lo que hay detrás de sus alias son despliegues de OpenAI,
 * Anthropic o Vertex, y el texto sale por ahí exactamente igual. Además el motor ya no puede
 * verlo: los destinos viven en `config.yaml` del gateway, así que si la guarda tratara a
 * `litellm` como local bastaría con añadir un despliegue remoto a ESE fichero para transferir
 * datos al exterior sin tocar nada del motor y sin que nadie lo declarase. Un despliegue con
 * el gateway apuntado sólo a modelos dentro del perímetro declara la variable igualmente —una
 * afirmación de más—; lo contrario sería una transferencia de menos.
 *
 * **`openrouter` es el caso sin matiz.** No hay perímetro que valga: es un servicio alojado
 * que reenvía a proveedores alojados, y el texto sale del país en la primera llamada.
 */
function assertTransferAllowed(
  kind: ProviderKind,
  selection: { NODE_ENV?: string; SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER: boolean },
): void {
  // `cascade` NO se exime por empezar en local: su escalón siguiente es el gateway, y
  // basta con que una glosa no la resuelva el codificador para que su texto salga
  // fuera. Eximirlo haría que la declaración dependiera de cuántas glosas resulten
  // difíciles, que no es una propiedad del despliegue sino de los extractos del día.
  if (kind === 'transformer') return;
  if (selection.NODE_ENV !== 'production') return;
  if (selection.SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER) return;
  throw new Error(
    'El proveedor semántico alojado transfiere el texto analizado fuera del país y esta ' +
      'instalación no lo ha declarado. Configura SEMANTIC_ALLOW_INTERNATIONAL_TRANSFER=true ' +
      'una vez cubiertas las obligaciones de transferencia internacional, o usa el proveedor ' +
      '`transformer`, que se ejecuta dentro del perímetro.',
  );
}

type ProviderKind = 'openai' | 'transformer' | 'litellm' | 'openrouter' | 'cascade';

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
    probeCacheSize: options.probeCacheSize,
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

/**
 * El gateway se comprueba contra el presupuesto igual que el proveedor generativo directo: sus
 * reintentos tampoco ven el reloj del análisis, y encima el gateway puede sumar los suyos
 * propios por debajo. El peor caso que se calcula aquí es por tanto un SUELO, no un techo;
 * `num_retries` en `config.yaml` es la otra mitad de la cuenta y debe mantenerse en 0 o 1.
 */
function buildLiteLlmModelProvider(
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
function buildOpenRouterModelProvider(
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
function buildLiteLlmEmbeddingProvider(environment: NodeJS.ProcessEnv): EmbeddingProvider {
  const options = loadLiteLlmEmbeddingOptions(environment);
  return new OpenAiEmbeddingProvider(options);
}

function buildOpenAiEmbeddingProvider(environment: NodeJS.ProcessEnv): EmbeddingProvider {
  const options = loadOpenAiProviderOptions(environment);
  return new OpenAiEmbeddingProvider({
    apiKey: options.apiKey,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    model: environment['SEMANTIC_EMBEDDING_MODEL'] ?? 'text-embedding-3-small',
  });
}
