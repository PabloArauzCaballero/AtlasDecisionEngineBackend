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
import { environmentOverridesFor } from './model-settings/environment-overrides';
import type { EffectiveModelSettings } from './model-settings/semantic-model-settings.service';

/**
 * Lo que el puente necesita de la configuración del portal. Se declara
 * estructuralmente para que una prueba pueda pasar un objeto literal y para
 * que el puente no arrastre el servicio entero.
 */
export interface ModelSettingsSource {
  /** Si la elección de gateway tiene efecto en este despliegue. */
  applies(): boolean;
  current(): Promise<EffectiveModelSettings>;
  /** Lo último resuelto, sin consultar. */
  peek(): EffectiveModelSettings | undefined;
  /** Avisa cuando cambia. Devuelve la baja. */
  onChange(listener: (settings: EffectiveModelSettings) => void): () => void;
}

/** Lo que hay que vaciar cuando cambia el modelo: los veredictos del anterior. */
export interface ClearableCache {
  clear(): void;
}

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
 * Y una tercera cosa, que llegó después: **la configuración del portal**. El
 * gateway y los modelos del escalón remoto pueden cambiarse en caliente, así
 * que el proveedor construido se cachea por VERSIÓN de esa configuración y no
 * para siempre. Cambiar de modelo reconstruye el adaptador en la siguiente
 * clasificación y vacía la caché de veredictos: lo que calculó el modelo
 * anterior no se sirve como si lo hubiera calculado el nuevo — el mismo
 * defecto que ya tuvo el catálogo cuando editar una categoría no cambiaba su
 * firma.
 *
 * La configuración se expresa como variables de entorno sobre `process.env` y
 * pasa por la misma fábrica: un modelo elegido en la pantalla y el mismo
 * modelo puesto en `.env` construyen exactamente el mismo adaptador, con las
 * mismas validaciones y la misma comprobación de presupuesto.
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
  settings?: ModelSettingsSource,
  classificationCache?: ClearableCache,
): SemanticModelProvider & Required<Pick<SemanticModelProvider, 'modelFor'>> {
  return new RoutedSemanticModelProvider(config, workerConfig, settings, classificationCache);
}

class RoutedSemanticModelProvider implements SemanticModelProvider {
  private resolved?: { readonly provider: SemanticModelProvider; readonly version: number };

  constructor(
    private readonly config: ConfigService,
    private readonly workerConfig: SemanticWorkerConfig,
    private readonly settings?: ModelSettingsSource,
    private readonly classificationCache?: ClearableCache,
  ) {
    // El aviso llega del sondeo del worker o de la escritura de la API. Se
    // vacía la caché AQUÍ y no al reconstruir, para que un acierto de caché
    // —que nunca llega a construir nada— tampoco sirva un veredicto viejo.
    this.settings?.onChange(() => {
      this.resolved = undefined;
      this.classificationCache?.clear();
    });
  }

  // `async` a propósito: sin él, un fallo de configuración se lanzaría de forma
  // SÍNCRONA desde un método que declara devolver una promesa, y el `.catch()`
  // del llamador no lo vería. El processor trata los fallos por la vía de la
  // promesa, así que uno síncrono escaparía a su clasificación de errores.
  async classify(
    input: ModelClassificationInput,
    tier: AnalysisTier,
    signal?: AbortSignal,
  ): Promise<ModelClassification> {
    const provider = await this.provider();
    return provider.classify(input, tier, signal);
  }

  /**
   * `modelFor` es opcional en el puerto y se invoca en el camino de error: si
   * el adaptador no puede construirse, la métrica de fallo se queda sin
   * atribución en vez de romper ese camino.
   */
  modelFor(tier: AnalysisTier): string {
    try {
      if (this.resolved === undefined) {
        // Con lo último que se conozca del portal, sin consultar: este camino es
        // síncrono. Si el portal aún no se ha leído, se construye desde el
        // entorno y la primera clasificación lo reemplazará si la versión difiere.
        const effective = this.settingsIfApply()?.peek();
        this.resolved = { provider: this.build(effective), version: effective?.version ?? 0 };
      }
      return this.resolved.provider.modelFor?.(tier) ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private async provider(): Promise<SemanticModelProvider> {
    const source = this.settingsIfApply();
    const effective = source === undefined ? undefined : await source.current();
    const version = effective?.version ?? 0;
    if (this.resolved !== undefined && this.resolved.version === version) {
      return this.resolved.provider;
    }
    const provider = this.build(effective);
    this.resolved = { provider, version };
    return provider;
  }

  private settingsIfApply(): ModelSettingsSource | undefined {
    return this.settings?.applies() === true ? this.settings : undefined;
  }

  private build(effective: EffectiveModelSettings | undefined): SemanticModelProvider {
    const selected = this.config.get<string>('SEMANTIC_ANALYSIS_PROVIDER') ?? '';
    if (selected === '') {
      // No retryable a propósito: reintentar no va a hacer aparecer la
      // configuración, y cada intento gastaría un lease de la ejecución.
      throw new SemanticConfigurationError(
        'No hay proveedor de modelo semántico configurado: defina SEMANTIC_ANALYSIS_PROVIDER (transformer | cascade | litellm | openrouter | openai).',
      );
    }

    const overrides =
      effective === undefined
        ? {}
        : environmentOverridesFor(
            selected,
            effective.gateway,
            effective.fastModel,
            effective.deepModel,
          );

    try {
      return loadModelProviders(
        { ...process.env, SEMANTIC_MODEL_PROVIDER: selected, ...overrides },
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
  }
}
