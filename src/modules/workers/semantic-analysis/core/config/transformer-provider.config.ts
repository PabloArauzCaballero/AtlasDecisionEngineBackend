import { z } from 'zod';
import { TransformerEmbeddingProviderOptions } from '../infrastructure/transformer/transformer-embedding.provider';
import { ClassifierThresholds } from '../infrastructure/transformer/transformer-classifier';

/**
 * Configuración del adaptador de transformers.
 *
 * Los umbrales viven en el entorno, no en el código, porque pertenecen al modelo
 * servido: cambiar de `multilingual-e5-small` a un BGE mueve la escala entera.
 * Los valores por defecto están MEDIDOS sobre e5 con el árbol de gastos
 * sembrado, no elegidos a ojo — la medición está en el comentario de
 * `ClassifierThresholds` y se reproduce con `scripts/semantic-calibration.mjs`.
 * Al cambiar de modelo hay que volver a correrla en vez de heredar los números.
 */
const environmentSchema = z.object({
  TRANSFORMER_BASE_URL: z.url().default('http://127.0.0.1:8080'),
  TRANSFORMER_API_KEY: z.string().trim().min(1).optional(),
  SEMANTIC_TRANSFORMER_MODEL: z.string().trim().min(1).default('intfloat/multilingual-e5-small'),
  // Muy por debajo de los 30 s de un modelo generativo: un codificador pequeño
  // resuelve un lote de decenas de textos en cientos de milisegundos, y un
  // presupuesto holgado sólo retrasaría el diagnóstico de un servidor colgado.
  SEMANTIC_TRANSFORMER_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(15_000),
  // Debe ser menor o igual que el `--max-client-batch-size` del servidor, que
  // rechaza el lote entero al superarlo. 32 es el valor por defecto de TEI.
  SEMANTIC_TRANSFORMER_BATCH_SIZE: z.coerce.number().int().min(1).max(512).default(32),
  /**
   * Prefijos de la familia e5. Vacíos para BGE y la mayoría de los demás: un
   * prefijo que el modelo no vio en su entrenamiento es ruido añadido a cada
   * texto, y desplaza todas las similitudes a la vez.
   */
  SEMANTIC_TRANSFORMER_QUERY_PREFIX: z.string().default('query: '),
  SEMANTIC_TRANSFORMER_PASSAGE_PREFIX: z.string().default('passage: '),
  SEMANTIC_TRANSFORMER_SIMILARITY_FLOOR: z.coerce.number().min(0).max(1).default(0.87),
  /**
   * Temperatura del reparto de confianza, y BAJA al crecer el catálogo.
   *
   * No es una preferencia: con más hojas sembradas TODAS casan un poco mejor con
   * cualquier glosa, el ganador se despega menos del pelotón y las hojas de
   * umbral alto —tributos, financieros— dejan de alcanzarlo. Está medido en el
   * `.env`: con 48 hojas y el vocabulario de comercios, a 0,01 la calibración
   * caía a 20/21 y los siete extractos reales pasaban de 205 a 168 glosas
   * clasificadas; a 0,005 volvía a 21/21.
   *
   * El árbol sembrado hoy es tres veces aquel, así que el valor por omisión es el
   * medido como bueno y no el que aquella medición descartó. **Sigue pendiente
   * volver a correr `scripts/semantic-calibration.mjs` sobre el catálogo actual**:
   * lo más probable es que el óptimo esté todavía por debajo.
   */
  SEMANTIC_TRANSFORMER_TEMPERATURE: z.coerce.number().min(0.001).max(1).default(0.005),
  SEMANTIC_TRANSFORMER_CONTRADICTION_MARGIN: z.coerce.number().min(0).max(1).default(0.02),
  /**
   * Intentos ante un fallo pasajero del servidor de embeddings. `1` desactiva
   * el reintento y devuelve el comportamiento anterior, en el que un 503 de
   * arranque tumbaba el análisis completo.
   */
  SEMANTIC_TRANSFORMER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  SEMANTIC_TRANSFORMER_RETRY_BACKOFF_MS: z.coerce.number().int().min(0).max(10_000).default(250),
  /**
   * Sondas de catálogo cuyo vector se conserva en memoria. `0` desactiva la
   * caché y vuelve a calcular el catálogo entero en cada glosa.
   *
   * El valor por omisión se dimensiona sobre el catálogo sembrado —enunciados
   * más ejemplos más contraejemplos— y hay que subirlo al ampliarlo: por debajo
   * de esa suma la LRU expulsa vectores que va a volver a pedir.
   */
  SEMANTIC_TRANSFORMER_PROBE_CACHE_SIZE: z.coerce.number().int().min(0).max(100_000).default(4_000),
});

export interface TransformerProviderOptions {
  readonly embedding: TransformerEmbeddingProviderOptions;
  readonly thresholds: ClassifierThresholds;
  readonly queryPrefix: string;
  readonly passagePrefix: string;
  readonly probeCacheSize: number;
}

/** Construye las opciones del adaptador a partir del entorno. */
export function loadTransformerProviderOptions(
  environment: NodeJS.ProcessEnv = process.env,
): TransformerProviderOptions {
  const parsed = environmentSchema.parse(environment);

  return {
    embedding: {
      baseUrl: parsed.TRANSFORMER_BASE_URL,
      ...(parsed.TRANSFORMER_API_KEY === undefined ? {} : { apiKey: parsed.TRANSFORMER_API_KEY }),
      model: parsed.SEMANTIC_TRANSFORMER_MODEL,
      timeoutMs: parsed.SEMANTIC_TRANSFORMER_TIMEOUT_MS,
      batchSize: parsed.SEMANTIC_TRANSFORMER_BATCH_SIZE,
      maxAttempts: parsed.SEMANTIC_TRANSFORMER_MAX_ATTEMPTS,
      retryBackoffMs: parsed.SEMANTIC_TRANSFORMER_RETRY_BACKOFF_MS,
    },
    thresholds: {
      similarityFloor: parsed.SEMANTIC_TRANSFORMER_SIMILARITY_FLOOR,
      temperature: parsed.SEMANTIC_TRANSFORMER_TEMPERATURE,
      contradictionMargin: parsed.SEMANTIC_TRANSFORMER_CONTRADICTION_MARGIN,
    },
    queryPrefix: parsed.SEMANTIC_TRANSFORMER_QUERY_PREFIX,
    passagePrefix: parsed.SEMANTIC_TRANSFORMER_PASSAGE_PREFIX,
    probeCacheSize: parsed.SEMANTIC_TRANSFORMER_PROBE_CACHE_SIZE,
  };
}
