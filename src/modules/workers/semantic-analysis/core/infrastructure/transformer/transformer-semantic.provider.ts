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
}

const DEFAULT_MAX_EVIDENCE_LENGTH = 500;

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
 */
export class TransformerSemanticProvider implements SemanticModelProvider {
  private readonly maxEvidenceLength: number;

  public constructor(private readonly options: TransformerSemanticProviderOptions) {
    this.maxEvidenceLength = options.maxEvidenceLength ?? DEFAULT_MAX_EVIDENCE_LENGTH;
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
    const vectors = await this.options.embeddings.embed(
      [query, ...probes.map((p) => p.text)],
      signal,
    );

    const queryVector = vectors[0];
    if (queryVector === undefined) {
      throw new SemanticProviderError('El servicio de embeddings no devolvió el vector del texto.');
    }

    const classification = modelClassificationSchema.parse({
      assessments: this.withEvidence(
        assess(input, probes, vectors.slice(1), queryVector, this.options),
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
