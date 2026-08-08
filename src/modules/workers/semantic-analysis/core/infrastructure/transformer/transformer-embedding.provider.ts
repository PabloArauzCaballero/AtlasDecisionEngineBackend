import { EmbeddingProvider } from '../../application/ports';
import {
  SemanticConfigurationError,
  SemanticProviderError,
} from '../../domain/semantic-analysis.errors';

export interface TransformerEmbeddingProviderOptions {
  /** Nombre del modelo servido. Sólo se usa para etiquetar vectores y métricas. */
  readonly model?: string;
  /** Raíz del servidor de inferencia, **sin** `/v1`: este adaptador usa `/embed`. */
  readonly baseUrl?: string;
  /** Sólo para instancias publicadas tras un proxy autenticado. */
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  /**
   * Textos por petición. El servidor rechaza el lote entero al superar su
   * `max-client-batch-size`, así que el valor de aquí debe ser menor o igual que
   * el suyo: 32 es el que trae por defecto.
   */
  readonly batchSize?: number;
  /** Recorta el texto al contexto del modelo en lugar de fallar. */
  readonly truncate?: boolean;
  readonly fetchImplementation?: typeof fetch;
}

/** Códigos con los que el servidor dice «vuelve a intentarlo», no «esto está mal». */
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

const DEFAULT_MODEL = 'intfloat/multilingual-e5-small';
const DEFAULT_BASE_URL = 'http://127.0.0.1:8080';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_BATCH_SIZE = 32;

/**
 * Adaptador de embeddings sobre un servidor de inferencia de transformers
 * (Hugging Face Text Embeddings Inference y compatibles).
 *
 * Es la única pieza que habla por red en el clasificador: todo lo demás —la
 * similitud, la contradicción, la confianza— es aritmética sobre los vectores
 * que devuelve. Esa separación es deliberada: permite probar el criterio de
 * clasificación sin levantar ningún servidor, y cambiar de modelo sin tocar el
 * criterio.
 *
 * `normalize: true` va siempre. Con vectores de norma 1 el producto escalar ES
 * el coseno, de modo que la similitud no depende de la longitud del texto —y un
 * concepto de gasto se describe indistintamente con tres palabras o con veinte.
 *
 * No reintenta. Igual que su equivalente de OpenAI, quien decide si insistir es
 * el clasificador que lo usa, que tiene el presupuesto del análisis a la vista.
 */
export class TransformerEmbeddingProvider implements EmbeddingProvider {
  public readonly model: string;
  private readonly requestFetch: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly batchSize: number;
  private readonly truncate: boolean;

  public constructor(private readonly options: TransformerEmbeddingProviderOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.requestFetch = options.fetchImplementation ?? fetch;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
    this.truncate = options.truncate ?? true;
  }

  public async embed(
    texts: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) {
      return [];
    }
    const vectors: (readonly number[])[] = [];
    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      vectors.push(
        ...(await this.embedBatch(texts.slice(offset, offset + this.batchSize), signal)),
      );
    }
    return vectors;
  }

  private async embedBatch(
    texts: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly (readonly number[])[]> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);

    let response: Response;
    try {
      response = await this.requestFetch(`${this.baseUrl}/embed`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.options.apiKey === undefined
            ? {}
            : { Authorization: `Bearer ${this.options.apiKey}` }),
        },
        body: JSON.stringify({ inputs: [...texts], truncate: this.truncate, normalize: true }),
        signal: combined,
      });
    } catch (error: unknown) {
      throw this.toTransportError(error, signal);
    }

    if (!response.ok) {
      throw this.toStatusError(response.status);
    }
    return this.readVectors(await response.json(), texts.length);
  }

  /**
   * El servidor devuelve un array de vectores en el MISMO orden de entrada, sin
   * índices que reordenar. A cambio hay que verificar el cardinal: una respuesta
   * más corta desplazaría cada vector una posición y la similitud se calcularía
   * contra la categoría equivocada, sin que nada lo señalara.
   */
  private readVectors(payload: unknown, expected: number): readonly (readonly number[])[] {
    if (!Array.isArray(payload)) {
      throw new SemanticProviderError(
        'El servicio de embeddings no devolvió una lista de vectores.',
      );
    }
    if (payload.length !== expected) {
      throw new SemanticProviderError(
        `El servicio de embeddings devolvió ${String(payload.length)} vectores para ${String(expected)} textos.`,
      );
    }
    return payload.map((vector: unknown) => {
      if (!Array.isArray(vector) || vector.length === 0) {
        throw new SemanticProviderError('El servicio de embeddings devolvió un vector vacío.');
      }
      if (
        !vector.every(
          (value): value is number => typeof value === 'number' && Number.isFinite(value),
        )
      ) {
        throw new SemanticProviderError(
          'El servicio de embeddings devolvió un vector no numérico.',
        );
      }
      return vector;
    });
  }

  /**
   * El `413` merece trato propio: es el techo de tokens del servidor, y con
   * `truncate` activo sólo puede venir de un lote demasiado grande. Reintentarlo
   * no cambia nada, y el diagnóstico ahorra buscar en el sitio equivocado.
   */
  private toStatusError(status: number): SemanticProviderError {
    if (status === 413) {
      return new SemanticProviderError(
        `El servidor de embeddings rechazó el lote por tamaño (HTTP 413). ` +
          `Baje SEMANTIC_TRANSFORMER_BATCH_SIZE por debajo de ${String(this.batchSize)}.`,
        false,
      );
    }
    return new SemanticProviderError(
      `El servicio de embeddings respondió con HTTP ${String(status)}.`,
      RETRYABLE_STATUS_CODES.has(status),
    );
  }

  private toTransportError(error: unknown, signal?: AbortSignal): SemanticProviderError {
    if (signal?.aborted === true) {
      return new SemanticProviderError(
        'El análisis fue abortado por presupuesto de tiempo.',
        false,
        {
          cause: error,
        },
      );
    }
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return new SemanticProviderError(
        `La llamada al servidor de embeddings superó ${String(this.timeoutMs)} ms.`,
        true,
        { cause: error },
      );
    }
    // Servidor caído o inalcanzable. La URL no es un secreto y orienta el diagnóstico.
    return new SemanticProviderError(
      `No fue posible contactar con el servidor de embeddings en ${this.baseUrl}.`,
      true,
      { cause: error },
    );
  }
}

/**
 * Rechaza la URL de la capa compatible con OpenAI.
 *
 * Es el error de configuración más probable de este adaptador: el mismo servidor
 * publica `/v1/embeddings` además de `/embed`, y apuntar a `…/v1` produciría un
 * 404 que se lee como «el servidor no está levantado».
 */
function normalizeBaseUrl(baseUrl: string | undefined): string {
  const normalized = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, '');
  if (normalized.endsWith('/v1')) {
    throw new SemanticConfigurationError(
      'TRANSFORMER_BASE_URL debe apuntar a la raíz del servidor (por ejemplo http://tei:80), ' +
        'no a su capa compatible con OpenAI: este adaptador usa la API nativa /embed.',
    );
  }
  return normalized;
}
