import type { ConfigService } from '@nestjs/config';
import type { SemanticModelProvider } from './core/application/ports';
import { loadModelProviders } from './core/config/model-provider.factory';
import type { SemanticWorkerConfig } from './core/config/semantic-worker.config';
import { SemanticConfigurationError } from './core/domain/semantic-analysis.errors';
import type {
  AnalysisTier,
  ModelClassification,
  ModelClassificationInput,
} from './core/domain/semantic-analysis.types';

/**
 * Puente entre la selección de proveedor del motor y la fábrica del núcleo.
 *
 * Resuelve dos desajustes que aparecieron al absorber el paquete (ADR-0026):
 *
 * 1. **Construcción perezosa.** La fábrica del núcleo valida credenciales al
 *    construir: sin `OPENAI_API_KEY` lanza. Instanciarla al cablear el módulo
 *    hacía que *cualquier* proceso —incluida una réplica de API con el worker
 *    apagado, y la generación del contrato OpenAPI— no arrancara sin una clave
 *    de OpenAI. El proveedor se construye ahora en la primera clasificación
 *    real, que es cuando la credencial hace falta de verdad.
 * 2. **Un solo nombre de variable.** El núcleo lee `SEMANTIC_MODEL_PROVIDER` y
 *    asume `openai` por defecto; el motor declara `SEMANTIC_ANALYSIS_PROVIDER`
 *    en su `env.schema` y la usa para decidir si el worker se registra. Mandar
 *    la del motor evita que el worker arranque con un proveedor y clasifique
 *    con otro. Se traduce aquí, igual que hace `semantic-config.bridge.ts` con
 *    el resto de la configuración, para no tocar el núcleo absorbido.
 *
 * La construcción perezosa sigue siendo necesaria con `transformer`, aunque no
 * exija credencial: el adaptador rechaza en el constructor una URL apuntada a la
 * capa compatible con OpenAI, y ese fallo tumbaría el arranque de toda réplica
 * en vez de la primera clasificación.
 */
/**
 * `modelFor` se declara obligatorio en el retorno aunque el puerto lo marque
 * opcional: este envoltorio siempre lo implementa —delegando o devolviendo
 * `unknown`— y anunciarlo evita que cada consumidor tenga que comprobarlo.
 */
export function buildSemanticModelProvider(
  config: ConfigService,
  workerConfig: SemanticWorkerConfig,
): SemanticModelProvider & Required<Pick<SemanticModelProvider, 'modelFor'>> {
  return new LazySemanticModelProvider(config, workerConfig);
}

class LazySemanticModelProvider implements SemanticModelProvider {
  private resolved?: SemanticModelProvider;

  constructor(
    private readonly config: ConfigService,
    private readonly workerConfig: SemanticWorkerConfig,
  ) {}

  // `async` a propósito: sin él, un fallo de configuración se lanzaría de forma
  // SÍNCRONA desde un método que declara devolver una promesa, y el `.catch()`
  // del llamador no lo vería. El processor trata los fallos por la vía de la
  // promesa, así que uno síncrono escaparía a su clasificación de errores.
  async classify(
    input: ModelClassificationInput,
    tier: AnalysisTier,
    signal?: AbortSignal,
  ): Promise<ModelClassification> {
    return this.provider().classify(input, tier, signal);
  }

  modelFor(tier: AnalysisTier): string {
    const provider = this.provider();
    // `modelFor` es opcional en el puerto: si el adaptador elegido no fija el
    // modelo por nivel, la métrica de fallo se queda sin atribución en vez de
    // romper el camino de error, que es donde se invoca.
    return provider.modelFor?.(tier) ?? 'unknown';
  }

  private provider(): SemanticModelProvider {
    if (this.resolved) return this.resolved;

    const selected = this.config.get<string>('SEMANTIC_ANALYSIS_PROVIDER') ?? '';
    if (selected === '') {
      // No retryable a propósito: reintentar no va a hacer aparecer la
      // configuración, y cada intento gastaría un lease de la ejecución.
      throw new SemanticConfigurationError(
        'No hay proveedor de modelo semántico configurado: defina SEMANTIC_ANALYSIS_PROVIDER (openai | transformer).',
      );
    }

    try {
      this.resolved = loadModelProviders(
        { ...process.env, SEMANTIC_MODEL_PROVIDER: selected },
        this.workerConfig,
      ).modelProvider;
    } catch (error) {
      // La causa original puede llevar el detalle de qué variable falta; el
      // mensaje propio nunca incluye el valor de ninguna de ellas.
      throw new SemanticConfigurationError(
        `No se pudo construir el proveedor de modelo semántico "${selected}". Revise su configuración.`,
        { cause: error },
      );
    }
    return this.resolved;
  }
}
