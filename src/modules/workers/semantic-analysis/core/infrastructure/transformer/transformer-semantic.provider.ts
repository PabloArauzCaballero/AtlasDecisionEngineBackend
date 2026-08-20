import { EmbeddingProvider, SemanticModelProvider } from '../../application/ports';
import {
  AnalysisTier,
  CategoryAssessment,
  ModelClassification,
  ModelClassificationInput,
} from '../../domain/semantic-analysis.types';
import { modelClassificationSchema } from '../../domain/semantic-analysis.schemas';
import { SemanticProviderError, SemanticTimeoutError } from '../../domain/semantic-analysis.errors';
import { assertOnlyCandidateCodes } from '../model/classification-contract';
import {
  ClassifierThresholds,
  assess,
  buildProbes,
  type CategoryProbe,
} from './transformer-classifier';

export interface TransformerSemanticProviderOptions extends ClassifierThresholds {
  /** Quien produce los vectores. Inyectado para poder clasificar sin red en pruebas. */
  readonly embeddings: EmbeddingProvider;
  /**
   * Prefijos que el modelo espera para distinguir la consulta del documento.
   *
   * La familia e5 se entrenó con `query: ` y `passage: ` y pierde precisión sin
   * ellos; BGE y la mayoría de los demás los quieren vacíos. Son configurables
   * porque son una propiedad del modelo servido, no de este adaptador.
   */
  readonly queryPrefix: string;
  readonly passagePrefix: string;
  /** Longitud máxima del fragmento citado como evidencia. */
  readonly maxEvidenceLength?: number;
  /**
   * Sondas cuyo vector se conserva en memoria entre clasificaciones. `0`
   * desactiva la caché y vuelve al comportamiento anterior.
   */
  readonly probeCacheSize?: number;
}

const DEFAULT_MAX_EVIDENCE_LENGTH = 500;
/**
 * Tamaño de la caché de sondas, y la aritmética que lo fija.
 *
 * En `DEEP` cada categoría candidata aporta su enunciado más cada ejemplo y cada
 * contraejemplo, así que el total de sondas del catálogo es la suma de las tres
 * cosas. El árbol sembrado ronda hoy las 2.800 —164 categorías, unos 2.250
 * ejemplos y 400 contraejemplos—, de modo que los 1.000 de antes ya no cabían: la
 * caché LRU se vaciaba a sí misma y volvía a pedir vectores que acababa de
 * calcular, que es el peor de los dos mundos —memoria ocupada y ninguna llamada
 * ahorrada—.
 *
 * Cuatro mil cubren el catálogo entero con sitio para que siga creciendo, y son
 * unos 12 MB con vectores de 384 dimensiones. **Al ampliar el catálogo hay que
 * revisar este número**: si la suma de sondas lo supera, la caché deja de servir
 * de golpe y no hay ninguna señal que lo diga salvo la latencia.
 */
const DEFAULT_PROBE_CACHE_SIZE = 4_000;

/**
 * Clasificador de texto sobre un transformer codificador.
 *
 * Sustituye al adaptador generativo que había antes (ADR-0026 usaba un modelo de
 * chat con salida estructurada). El cambio responde a lo que este worker hace de
 * verdad: asignar una descripción corta —el concepto de un movimiento bancario—
 * a una categoría de un catálogo cerrado. Para eso no hace falta un modelo que
 * escriba; basta uno que mida, y medir es varios órdenes de magnitud más barato,
 * determinista a igualdad de modelo, y no tiene forma de obedecer instrucciones
 * escondidas en el texto que analiza.
 *
 * Lo que se pierde con el cambio, dicho sin rodeos: el juicio sobre matices que
 * el catálogo no anticipó. Un codificador sólo sabe de parecido con lo que
 * alguien escribió en las sondas, así que una categoría con dos ejemplos pobres
 * clasifica peor que antes. El remedio es el catálogo, no el modelo.
 *
 * **Una sola llamada de red por nivel.** El texto y todas las sondas van en el
 * mismo lote: partirlos multiplicaría la latencia por el número de categorías
 * sin cambiar un solo resultado.
 *
 * **Y esa llamada sólo lleva lo que falta.** Las sondas son texto del CATÁLOGO:
 * el enunciado de una categoría y sus ejemplos son los mismos para la glosa de
 * ahora y para la de dentro de una hora. Volver a calcular sus vectores en cada
 * clasificación era pedirle al servidor de embeddings nueve textos —cincuenta en
 * `DEEP`— para aprovechar uno. Con la caché puesta, una tanda de extracto manda
 * un texto por glosa a partir de la primera, y lo que era el trabajo dominante
 * del worker desaparece: no es una mejora de constante, es un orden de magnitud.
 *
 * La caché no necesita invalidación porque la clave ES el texto de la sonda:
 * editar la descripción de una categoría produce una sonda distinta, con su
 * propia entrada, y la vieja se va sola al llenarse el hueco. Vive en el proceso
 * a propósito —un vector se recalcula en milisegundos y compartirlo entre
 * instancias costaría una consulta por clasificación, que es justo lo que se
 * está quitando—.
 */
export class TransformerSemanticProvider implements SemanticModelProvider {
  private readonly maxEvidenceLength: number;
  private readonly probeCacheSize: number;
  /**
   * Vectores de sonda por su texto exacto. `Map` conserva el orden de inserción,
   * que es lo que permite desalojar el menos usado en O(1): un acierto reinserta
   * la entrada al final y el desalojo se lleva siempre la primera.
   */
  private readonly probeCache = new Map<string, readonly number[]>();

  public constructor(private readonly options: TransformerSemanticProviderOptions) {
    this.maxEvidenceLength = options.maxEvidenceLength ?? DEFAULT_MAX_EVIDENCE_LENGTH;
    this.probeCacheSize = Math.max(0, options.probeCacheSize ?? DEFAULT_PROBE_CACHE_SIZE);
  }

  /**
   * El mismo modelo atiende los dos niveles.
   *
   * Un servidor de inferencia sirve UN modelo, y el nivel aquí no cambia de
   * modelo sino de profundidad de las sondas: `DEEP` compara además contra cada
   * ejemplo y cada contraejemplo. Devolver dos nombres distintos para el mismo
   * modelo dejaría la métrica de latencia partida en dos series que no lo están.
   */
  public modelFor(_tier: AnalysisTier): string {
    return this.options.embeddings.model;
  }

  public async classify(
    input: ModelClassificationInput,
    tier: AnalysisTier,
    signal?: AbortSignal,
  ): Promise<ModelClassification> {
    this.assertNotAborted(signal);

    const probes = buildProbes(input, tier, this.options.passagePrefix);
    if (probes.length === 0) {
      // Sin candidatos no hay nada que medir. El pipeline no llega aquí en ese
      // caso, pero devolver una clasificación vacía es más honesto que emitir
      // una petición cuyo resultado se descartaría.
      return this.emptyClassification();
    }

    const query = `${this.options.queryPrefix}${input.normalizedText}`;
    const { queryVector, probeVectors } = await this.resolveVectors(query, probes, signal);

    const classification = modelClassificationSchema.parse({
      assessments: this.withEvidence(
        assess(input, probes, probeVectors, queryVector, this.options),
        input,
      ),
      model: this.options.embeddings.model,
      modelVersion: `${this.options.embeddings.model}@${tier.toLowerCase()}`,
    });
    // Se mantiene aunque aquí sea trivialmente cierta: las evaluaciones se
    // construyen a partir de `input.candidates`. Es la barrera que garantiza que
    // la decisión nunca recaiga sobre una categoría no propuesta, y vale más
    // conservarla para que un cambio futuro la encuentre puesta.
    assertOnlyCandidateCodes(classification.assessments, input);
    return classification;
  }

  /**
   * Resuelve el vector del texto y el de cada sonda con una sola petición.
   *
   * El texto analizado va SIEMPRE —es distinto en cada glosa, y cachearlo sería
   * cachear la pregunta— y las sondas sólo cuando no están ya calculadas. Las
   * repetidas dentro de la misma tanda se piden una vez: dos categorías pueden
   * compartir un ejemplo, y mandarlo dos veces lo pagaría dos veces.
   *
   * Cuando no falta ninguna sonda la petición lleva un único texto, que es el
   * caso normal a partir de la segunda glosa de un extracto.
   */
  private async resolveVectors(
    query: string,
    probes: readonly CategoryProbe[],
    signal?: AbortSignal,
  ): Promise<{
    readonly queryVector: readonly number[];
    readonly probeVectors: readonly (readonly number[] | undefined)[];
  }> {
    const pendientes: string[] = [];
    const yaPedidas = new Set<string>();
    for (const probe of probes) {
      if (this.recuerda(probe.text) !== undefined || yaPedidas.has(probe.text)) continue;
      yaPedidas.add(probe.text);
      pendientes.push(probe.text);
    }

    const vectors = await this.options.embeddings.embed([query, ...pendientes], signal);
    const queryVector = vectors[0];
    if (queryVector === undefined) {
      throw new SemanticProviderError('El servicio de embeddings no devolvió el vector del texto.');
    }
    pendientes.forEach((text, indice) => {
      const vector = vectors[indice + 1];
      if (vector !== undefined) this.guarda(text, vector);
    });

    return { queryVector, probeVectors: probes.map((probe) => this.recuerda(probe.text)) };
  }

  /** Lee la caché y, al acertar, reinserta la entrada como la más reciente. */
  private recuerda(text: string): readonly number[] | undefined {
    const vector = this.probeCache.get(text);
    if (vector === undefined) return undefined;
    this.probeCache.delete(text);
    this.probeCache.set(text, vector);
    return vector;
  }

  private guarda(text: string, vector: readonly number[]): void {
    if (this.probeCacheSize === 0) return;
    this.probeCache.set(text, vector);
    while (this.probeCache.size > this.probeCacheSize) {
      const masAntigua = this.probeCache.keys().next();
      if (masAntigua.done === true) break;
      this.probeCache.delete(masAntigua.value);
    }
  }

  /**
   * Añade el fragmento del texto analizado que respalda cada evaluación.
   *
   * El respaldo de un codificador es el texto entero: no hay una parte que pese
   * más que otra, porque el vector se calcula sobre todo él. Citar el texto
   * completo dice la verdad; señalar una frase sugeriría una atribución que el
   * modelo no ha hecho.
   *
   * Las categorías descartadas se quedan sin cita: una evidencia junto a un
   * `supported: false` se lee como respaldo de algo que no se sostiene.
   */
  private withEvidence(
    assessments: readonly CategoryAssessment[],
    input: ModelClassificationInput,
  ): readonly CategoryAssessment[] {
    const fragment = input.normalizedText.slice(0, this.maxEvidenceLength);
    return assessments.map((assessment) => ({
      ...assessment,
      evidence: assessment.supported ? [fragment] : [],
    }));
  }

  private emptyClassification(): ModelClassification {
    return {
      assessments: [],
      model: this.options.embeddings.model,
      modelVersion: this.options.embeddings.model,
    };
  }

  private assertNotAborted(signal?: AbortSignal): void {
    if (signal?.aborted === true) {
      throw new SemanticTimeoutError('El presupuesto de análisis se agotó antes de la llamada.');
    }
  }
}

export type { CategoryProbe };
