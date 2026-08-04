import { EmbeddingProvider } from '../../application/ports';
import {
  SemanticConfigurationError,
  SemanticProviderError,
} from '../../domain/semantic-analysis.errors';

export interface OpenAiEmbeddingProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** Límite de textos por petición; evita superar el tamaño máximo de cuerpo del proveedor. */
  readonly batchSize?: number;
  readonly fetchImplementation?: typeof fetch;
}

interface OpenAiEmbeddingResponse {
  readonly data?: readonly { readonly index?: number; readonly embedding?: number[] }[];
}

const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_BATCH_SIZE = 96;

/**
 * Adaptador de embeddings sobre la API de OpenAI.
 *
 * Se mantiene deliberadamente simple: sin reintentos propios. El recuperador híbrido degrada al
 * modo léxico ante cualquier fallo, de modo que insistir aquí sólo retrasaría una clasificación
 * que puede completarse sin la señal vectorial.
 */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  public readonly model: string;
  private readonly requestFetch: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly batchSize: number;

  public constructor(private readonly options: OpenAiEmbeddingProviderOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new SemanticConfigurationError(
        'OPENAI_API_KEY es obligatoria al seleccionar OpenAiEmbeddingProvider.',
      );
    }
    this.model = options.model ?? DEFAULT_MODEL;
    this.requestFetch = options.fetchImplementation ?? fetch;
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/u, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
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

    const response = await this.requestFetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: combined,
    });
    if (!response.ok) {
      throw new SemanticProviderError(
        `El servicio de embeddings respondió con HTTP ${String(response.status)}.`,
        true,
      );
    }

    const payload = (await response.json()) as OpenAiEmbeddingResponse;
    const data = payload.data ?? [];
    if (data.length !== texts.length) {
      throw new SemanticProviderError(
        'El servicio de embeddings devolvió una cantidad de vectores distinta de la solicitada.',
      );
    }
    // El proveedor no garantiza el orden; se reordena por `index` antes de devolverlos.
    return [...data]
      .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
      .map((item) => {
        if (item.embedding === undefined || item.embedding.length === 0) {
          throw new SemanticProviderError('El servicio de embeddings devolvió un vector vacío.');
        }
        return item.embedding;
      });
  }
}
