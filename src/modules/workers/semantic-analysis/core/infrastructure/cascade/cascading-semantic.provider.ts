import { Logger } from '@nestjs/common';
import {
  AnalysisTier,
  ModelClassification,
  ModelClassificationInput,
} from '../../domain/semantic-analysis.types';
import { SemanticModelProvider } from '../../application/ports';

/**
 * Modelo que se publica cuando el clasificador local no llegó a responder.
 *
 * Es un valor CONSTANTE y no el nombre del codificador: si un fallo del local se
 * publicara con su nombre, la métrica de proveedor lo contaría como una llamada
 * suya que salió bien, y se perdería justo la señal que dice que el codificador
 * está degradado. Con una etiqueta propia —y de cardinalidad uno— la tasa de
 * «el local no pudo» es directamente visible en el tablero.
 */
export const LOCAL_UNAVAILABLE_MODEL = 'cascade:local-unavailable';

export interface CascadingSemanticProviderOptions {
  /** Clasificador dentro del perímetro. Decide primero y resuelve la mayoría. */
  readonly local: SemanticModelProvider;
  /** Sólo se consulta cuando el local no resolvió. Es el caro. */
  readonly remote: SemanticModelProvider;
  /**
   * Cuánto se le espera al local antes de darlo por perdido.
   *
   * No es su timeout —el adaptador local tiene el suyo—, es el punto a partir del
   * cual esperar más sale peor que preguntarle al modelo grande.
   */
  readonly localTimeoutMs: number;
  readonly logger?: Logger;
}

/**
 * El clasificador LOCAL manda; el LLM sólo entra cuando aquél no puede o tarda demasiado.
 *
 * ## Por qué el LLM no es el primero
 *
 * Un codificador local resuelve una glosa en milisegundos, dentro del perímetro y
 * sin coste por llamada. Un modelo generativo detrás de un gateway cuesta dinero,
 * tarda cientos de milisegundos y saca el texto del país. Con un extracto de
 * trescientos movimientos la diferencia entre preguntar siempre y preguntar sólo
 * lo que hace falta no es de matiz: es la mayor parte de la factura.
 *
 * ## Cómo se decide que «no pudo»
 *
 * **Aquí no se decide.** Ese criterio ya existe y vive en `DecisionEngine`: en el
 * nivel `FAST`, si ninguna candidata alcanza su umbral —o si las dos primeras
 * empatan dentro del margen de ambigüedad— la decisión sale con
 * `requiresDeepAnalysis`, y es el pipeline quien pide entonces el nivel `DEEP`.
 * Este adaptador se limita a atender cada nivel con quien corresponde:
 *
 * ```text
 * FAST  → clasificador local        (gratis, dentro del perímetro)
 *   ├── resuelve            → FIN, el LLM no se entera
 *   └── no resuelve / lento → el motor de decisión escala
 *                                   ↓
 * DEEP  → LiteLLM                   (se paga sólo aquí)
 * ```
 *
 * Duplicar el criterio de «no resolvió» dentro de este adaptador habría creado dos
 * definiciones de lo mismo que se separan en cuanto una de las dos cambie, y la que
 * mandaría sería la invisible.
 *
 * ## «Tarda demasiado» también es «no puede»
 *
 * Un local que se atasca no puede bloquear la clasificación: pasado
 * `localTimeoutMs` se le abandona y se devuelve una ABSTENCIÓN —ningún juicio, no
 * un juicio negativo—, que es lo que el motor de decisión lee como «no resolvió» y
 * lo que dispara el escalón siguiente. La alternativa —propagar el error— habría
 * mandado el caso a revisión humana teniendo un modelo capaz de resolverlo esperando
 * detrás.
 *
 * Lo que NO se sustituye es una respuesta débil: si el local contesta con poca
 * confianza, sus juicios viajan intactos al motor de decisión. Esa evidencia es
 * legítima y borrarla dejaría al escalón siguiente sin el contexto que el local sí
 * llegó a producir.
 */
export class CascadingSemanticProvider implements SemanticModelProvider {
  private readonly logger: Logger;

  public constructor(private readonly options: CascadingSemanticProviderOptions) {
    this.logger = options.logger ?? new Logger(CascadingSemanticProvider.name);
  }

  /** Qué modelo atiende cada nivel, para la métrica del camino de fallo. */
  public modelFor(tier: AnalysisTier): string {
    const provider = tier === 'FAST' ? this.options.local : this.options.remote;
    return provider.modelFor?.(tier) ?? (tier === 'FAST' ? 'local' : 'remote');
  }

  public async classify(
    input: ModelClassificationInput,
    tier: AnalysisTier,
    signal?: AbortSignal,
  ): Promise<ModelClassification> {
    // El nivel profundo ya ES la escalada: volver a preguntarle al local aquí sólo
    // repetiría la respuesta que acaba de no bastar.
    if (tier === 'DEEP') {
      return this.options.remote.classify(input, 'DEEP', signal);
    }
    return this.classifyLocally(input, signal);
  }

  private async classifyLocally(
    input: ModelClassificationInput,
    signal?: AbortSignal,
  ): Promise<ModelClassification> {
    try {
      return await this.withLocalDeadline(input, signal);
    } catch (error: unknown) {
      // Se degrada a abstención, no se propaga: propagar mandaría el caso a la
      // bandeja teniendo el escalón siguiente disponible.
      this.logger.warn(
        `El clasificador local no resolvió (${describe(error)}); se escala al modelo remoto.`,
      );
      return abstention();
    }
  }

  /**
   * El plazo propio del local, combinado con el presupuesto del análisis completo.
   *
   * El `AbortSignal` viaja al adaptador local para que ABANDONE de verdad su
   * trabajo: sin él, un `Promise.race` devolvería el control a tiempo pero dejaría
   * la petición viva consumiendo el mismo hilo y la misma CPU que necesita el
   * escalón siguiente.
   */
  private withLocalDeadline(
    input: ModelClassificationInput,
    signal?: AbortSignal,
  ): Promise<ModelClassification> {
    const deadline = AbortSignal.timeout(this.options.localTimeoutMs);
    const combined = signal === undefined ? deadline : AbortSignal.any([signal, deadline]);
    return this.options.local.classify(input, 'FAST', combined);
  }
}

/**
 * Ningún juicio, que no es lo mismo que un juicio negativo.
 *
 * Con la lista vacía, `DecisionEngine` no acepta ninguna candidata y en el nivel
 * `FAST` marca `requiresDeepAnalysis`. Devolver en su lugar juicios con
 * `supported: false` habría AFIRMADO que las candidatas no encajan —algo que el
 * local no llegó a comprobar— y eso sí contamina la evidencia que se audita.
 */
function abstention(): ModelClassification {
  return {
    assessments: [],
    model: LOCAL_UNAVAILABLE_MODEL,
    modelVersion: LOCAL_UNAVAILABLE_MODEL,
  };
}

/** Describe el fallo sin arrastrar el texto analizado a los registros. */
function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.name === 'TimeoutError' || error.name === 'AbortError'
      ? 'plazo agotado'
      : error.message.slice(0, 120);
  }
  return 'motivo desconocido';
}
