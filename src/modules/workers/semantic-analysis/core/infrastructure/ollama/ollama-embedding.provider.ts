import { EmbeddingProvider } from '../../application/ports';
import { SemanticProviderError } from '../../domain/semantic-analysis.errors';

export interface OllamaEmbeddingProviderOptions {
  readonly model?: string;
  /** Raíz del servidor Ollama, **sin** `/v1`: este adaptador usa la API nativa `/api/embed`. */
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  /**
   * Textos por petición. Menor que en un proveedor alojado: el límite aquí no es el tamaño del
   * cuerpo sino la memoria del servidor, que procesa el lote en paralelo.
   */
  readonly batchSize?: number;
  readonly keepAlive?: string;
  /** Recorta el texto al contexto del modelo en lugar de fallar. */
  readonly truncate?: boolean;
  readonly fetchImplementation?: typeof fetch;
}

interface OllamaEmbedResponse {
  readonly embeddings?: readonly number[][];
}

const DEFAULT_MODEL = 'bge-m3';
const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_BATCH_SIZE = 32;
const DEFAULT_KEEP_ALIVE = '30m';

/**
 * Adaptador de embeddings sobre un servidor Ollama.
 *
 * Igual que su equivalente de OpenAI, no reintenta: el recuperador híbrido degrada al modo léxico
 * ante cualquier fallo, e insistir sólo retrasaría una clasificación que puede completarse sin la
 * señal vectorial.
 *
 * A diferencia de la API de OpenAI, `/api/embed` devuelve los vectores en el orden de entrada, de
 * modo que no hay índice que reordenar; a cambio, sí conviene verificar el cardinal, porque un
 * texto vacío en el lote hace que el servidor lo omita en silencio.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  public readonly model: string;
  private readonly requestFetch: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly batchSize: number;
  private readonly keepAlive: string;
  private readonly truncate: boolean;

  public constructor(private readonly options: OllamaEmbeddingProviderOptions = {}) {
    this.model = options.model ?? DEFAULT_MODEL;
    this.requestFetch = options.fetchImplementation ?? fetch;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
    this.keepAlive = options.keepAlive ?? DEFAULT_KEEP_ALIVE;
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

    const response = await this.requestFetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.options.apiKey === undefined
          ? {}
          : { Authorization: `Bearer ${this.options.apiKey}` }),
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        truncate: this.truncate,
        keep_alive: this.keepAlive,
      }),
      signal: combined,
    });
    if (!response.ok) {
      if (response.status === 404) {
        throw new SemanticProviderError(
          `Ollama no reconoce el modelo de embeddings "${this.model}". ` +
            `Descárguelo con \`ollama pull ${this.model}\`.`,
          false,
        );
      }
      throw new SemanticProviderError(
        `El servicio de embeddings respondió con HTTP ${String(response.status)}.`,
        true,
      );
    }

    const payload = (await response.json()) as OllamaEmbedResponse;
    const embeddings = payload.embeddings ?? [];
    if (embeddings.length !== texts.length) {
      throw new SemanticProviderError(
        'El servicio de embeddings devolvió una cantidad de vectores distinta de la solicitada.',
      );
    }
    return embeddings.map((vector) => {
      if (vector.length === 0) {
        throw new SemanticProviderError('El servicio de embeddings devolvió un vector vacío.');
      }
      return vector;
    });
  }
}
