import { z } from 'zod';
import { emptyAsUndefined, boundedInt, optionalInt } from './helpers';

export const semanticTuningEnv = {
  // --- Worker semántico: ajustes que se leían fuera del esquema ------------------------
  // Candidatos que el recuperador entrega al clasificador por glosa.
  SEMANTIC_ANALYSIS_CANDIDATE_LIMIT: z.coerce.number().int().min(1).max(100).default(8),
  // Margen por debajo del cual dos categorías se consideran empatadas y la glosa ambigua.
  SEMANTIC_ANALYSIS_AMBIGUITY_MARGIN: z.coerce.number().min(0).max(1).default(0.08),
  // Vida del catálogo de categorías en memoria, en segundos.
  SEMANTIC_ANALYSIS_CATALOG_TTL_SECONDS: z.coerce.number().int().min(0).max(86_400).default(300),
  // Vida de una clasificación en la caché del proceso, en segundos. La frescura la garantiza la firma del catálogo, no este plazo.
  SEMANTIC_ANALYSIS_CLASSIFICATION_TTL_SECONDS: boundedInt(0, 604_800).default(3_600),
  // Entradas máximas de la caché de clasificaciones del proceso.
  SEMANTIC_ANALYSIS_CLASSIFICATION_CACHE: boundedInt(0, 1_000_000).default(5_000),
  // `lexical` (por omisión) o `hybrid`. El híbrido exige un proveedor de embeddings y gasta cuota en cada análisis; cualquier otro valor se lee como `lexical`.
  SEMANTIC_ANALYSIS_RETRIEVAL_MODE: emptyAsUndefined(z.string().optional()),
  // Peso de la similitud semántica frente a la léxica en el modo `hybrid` (0–1).
  SEMANTIC_ANALYSIS_SEMANTIC_WEIGHT: z.coerce.number().min(0).max(1).default(0.5),
  // Cada cuánto se relee de la base el modelo elegido desde el portal, en milisegundos. Sin valor manda el del servicio.
  SEMANTIC_MODEL_SETTINGS_REFRESH_MS: optionalInt(0, 3_600_000),
  // --- Servidor de embeddings (TEI) -----------------------------------------------------
  // El proveedor `transformer` del worker semántico valida estas claves con su propio esquema (semantic-analysis/core/config/transformer-provider.config.ts); aquí se declaran porque el comprobador de fraude documental de identidad las lee por ConfigService.
  // Raíz del servidor de embeddings, sin `/embed` (p. ej. `http://transformer:80`).
  TRANSFORMER_BASE_URL: emptyAsUndefined(z.string().url().optional()),
  // Credencial del servidor de embeddings, si la exige.
  TRANSFORMER_API_KEY: emptyAsUndefined(z.string().min(1).optional()),
  // Modelo que sirve el TEI; sin valor, `intfloat/multilingual-e5-small`.
  SEMANTIC_TRANSFORMER_MODEL: emptyAsUndefined(z.string().trim().min(1).optional()),
  // Prefijo de consulta del modelo E5; sin valor, `query: `.
  SEMANTIC_TRANSFORMER_QUERY_PREFIX: z.string().optional(),
  // Prefijo de pasaje del modelo E5; sin valor, `passage: `.
  SEMANTIC_TRANSFORMER_PASSAGE_PREFIX: z.string().optional(),
  // Plazo de cada llamada al servidor de embeddings, en milisegundos; sin valor, 15000.
  SEMANTIC_TRANSFORMER_TIMEOUT_MS: optionalInt(500, 120_000),
  // Intentos por llamada al servidor de embeddings; sin valor, 3.
  SEMANTIC_TRANSFORMER_MAX_ATTEMPTS: optionalInt(1, 10),
  // Espera entre intentos, en milisegundos; sin valor, 250.
  SEMANTIC_TRANSFORMER_RETRY_BACKOFF_MS: optionalInt(0, 10_000),
};
