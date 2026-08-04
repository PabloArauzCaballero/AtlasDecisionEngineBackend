import { setTimeout as delay } from 'node:timers/promises';
import {
  AnalysisTier,
  ModelClassification,
  ModelClassificationInput,
} from '../../domain/semantic-analysis.types';
import { modelClassificationSchema } from '../../domain/semantic-analysis.schemas';
import {
  SemanticConfigurationError,
  SemanticProviderError,
  SemanticTimeoutError,
} from '../../domain/semantic-analysis.errors';
import { SemanticModelProvider } from '../../application/ports';
import {
  assertOnlyCandidateCodes,
  buildModelPayload,
  buildSystemInstruction,
  buildClassificationSchema,
  candidateCodesOf,
} from '../model/classification-contract';

export interface OpenAiSemanticProviderOptions {
  readonly apiKey: string;
  readonly fastModel: string;
  readonly deepModel: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** Intentos adicionales ante fallos transitorios; `0` desactiva el reintento. */
  readonly maxAttempts?: number;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
  readonly maxOutputTokens?: number;
  readonly fetchImplementation?: typeof fetch;
  /** Inyectable para hacer determinista el jitter en pruebas. */
  readonly randomSource?: () => number;
}

interface OpenAiResponse {
  readonly model?: string;
  readonly output_text?: string;
  readonly status?: string;
  readonly incomplete_details?: { readonly reason?: string };
  readonly output?: readonly {
    readonly content?: readonly { readonly type?: string; readonly text?: string }[];
  }[];
}

const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/**
 * Códigos que llegan con un estado formalmente reintentable pero describen una
 * condición permanente de la cuenta. `insufficient_quota` viaja como 429 igual
 * que un límite de tasa: sin mirar el código, agotar el saldo consume los tres
 * intentos y su retroceso antes de fallar, y lo reporta como transitorio.
 */
const PERMANENT_ERROR_CODES: ReadonlySet<string> = new Set([
  'insufficient_quota',
  'billing_hard_limit_reached',
  'billing_not_active',
  'account_deactivated',
]);

/**
 * Forma admitida para un código de error del proveedor. Acota lo que puede
 * llegar al mensaje y a los registros: el cuerpo del error es texto controlado
 * por un tercero, y sólo el identificador —no la prosa que lo acompaña— tiene
 * valor para clasificar.
 */
const ERROR_CODE_SHAPE = /^[A-Za-z0-9_.-]{1,64}$/u;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 500;
const DEFAULT_MAX_BACKOFF_MS = 8_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 2_048;

/**
 * Adaptador aislado para clasificación estructurada mediante OpenAI Responses API.
 *
 * Reintenta sólo los fallos transitorios, con retroceso exponencial y jitter, y respeta
 * `Retry-After` cuando el proveedor lo indica. Los errores de contrato — esquema inválido,
 * categoría fuera del conjunto candidato, credenciales rechazadas — no se reintentan.
 */
export class OpenAiSemanticProvider implements SemanticModelProvider {
  private readonly requestTimeoutMs: number;
  private readonly requestFetch: typeof fetch;
  private readonly baseUrl: string;
  private readonly maxAttempts: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly maxOutputTokens: number;
  private readonly randomSource: () => number;

  public constructor(private readonly options: OpenAiSemanticProviderOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new SemanticConfigurationError(
        'OPENAI_API_KEY es obligatoria al seleccionar OpenAiSemanticProvider.',
      );
    }
    this.requestTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.requestFetch = options.fetchImplementation ?? fetch;
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/u, '');
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.randomSource = options.randomSource ?? Math.random;
  }

  public modelFor(tier: AnalysisTier): string {
    return tier === 'FAST' ? this.options.fastModel : this.options.deepModel;
  }

  public async classify(
    input: ModelClassificationInput,
    tier: AnalysisTier,
    signal?: AbortSignal,
  ): Promise<ModelClassification> {
    const model = this.modelFor(tier);
    let lastError: SemanticProviderError | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      this.assertNotAborted(signal);
      try {
        return await this.attemptClassification(input, model, tier, signal);
      } catch (error: unknown) {
        const providerError = this.toProviderError(error, signal);
        if (!providerError.retryable || attempt === this.maxAttempts) {
          throw providerError;
        }
        lastError = providerError;
        await this.waitBeforeRetry(attempt, this.retryAfterMs(error), signal);
      }
    }

    throw (
      lastError ?? new SemanticProviderError('No fue posible completar la clasificación.', true)
    );
  }

  private async attemptClassification(
    input: ModelClassificationInput,
    model: string,
    tier: AnalysisTier,
    signal?: AbortSignal,
  ): Promise<ModelClassification> {
    const timeout = AbortSignal.timeout(this.requestTimeoutMs);
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);

    const response = await this.requestFetch(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(this.createRequestBody(input, model, tier)),
      signal: combined,
    });

    if (!response.ok) {
      throw new HttpProviderError(
        response.status,
        this.parseRetryAfter(response),
        await this.parseErrorCode(response),
      );
    }

    const providerResponse = (await response.json()) as OpenAiResponse;
    if (providerResponse.status === 'incomplete') {
      throw new SemanticProviderError(
        `La respuesta quedó incompleta (${providerResponse.incomplete_details?.reason ?? 'motivo desconocido'}).`,
        true,
      );
    }

    const outputText = this.extractOutputText(providerResponse);
    const parsedOutput = this.parseJson(outputText);
    const classification = modelClassificationSchema.parse({
      ...parsedOutput,
      model: providerResponse.model ?? model,
      modelVersion: providerResponse.model ?? model,
    });
    assertOnlyCandidateCodes(classification.assessments, input);
    return classification;
  }

  private parseJson(outputText: string): Record<string, unknown> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch (error: unknown) {
      throw new SemanticProviderError('La salida estructurada no es JSON válido.', false, {
        cause: error,
      });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new SemanticProviderError('La salida estructurada no es un objeto JSON.');
    }
    return parsed as Record<string, unknown>;
  }

  /**
   * Clasifica cualquier fallo en reintentable o permanente sin filtrar el contenido analizado.
   */
  private toProviderError(error: unknown, signal?: AbortSignal): SemanticProviderError {
    if (error instanceof SemanticProviderError) {
      return error;
    }
    if (error instanceof HttpProviderError) {
      const retryable =
        RETRYABLE_STATUS_CODES.has(error.status) &&
        !(error.code !== undefined && PERMANENT_ERROR_CODES.has(error.code));
      const detail = error.code === undefined ? '' : ` (${error.code})`;
      return new SemanticProviderError(
        `OpenAI respondió con HTTP ${error.status}${detail}.`,
        retryable,
      );
    }
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
        `La llamada al proveedor superó ${this.requestTimeoutMs} ms.`,
        true,
        { cause: error },
      );
    }
    // Fallos de red y de DNS llegan aquí; son transitorios por defecto.
    return new SemanticProviderError('No fue posible completar la clasificación semántica.', true, {
      cause: error,
    });
  }

  private async waitBeforeRetry(
    attempt: number,
    retryAfterMs: number | undefined,
    signal?: AbortSignal,
  ): Promise<void> {
    const exponential = Math.min(this.initialBackoffMs * 2 ** (attempt - 1), this.maxBackoffMs);
    const jittered = Math.round(exponential * (0.5 + this.randomSource() * 0.5));
    const waitMs = Math.min(Math.max(retryAfterMs ?? jittered, 0), this.maxBackoffMs);
    try {
      await delay(waitMs, undefined, { signal });
    } catch (error: unknown) {
      throw new SemanticTimeoutError('El presupuesto se agotó durante la espera de reintento.', {
        cause: error,
      });
    }
  }

  private retryAfterMs(error: unknown): number | undefined {
    return error instanceof HttpProviderError ? error.retryAfterMs : undefined;
  }

  /**
   * Extrae `error.code` (o `error.type`) del cuerpo de un error.
   *
   * Nunca propaga un fallo propio: un cuerpo vacío, truncado o que no sea JSON
   * deja el código sin determinar, y la clasificación cae de vuelta en el estado
   * HTTP. Perder el código degrada la precisión; hacer fallar la lectura
   * perdería además el error real del proveedor.
   */
  private async parseErrorCode(response: Response): Promise<string | undefined> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return undefined;
    }
    if (typeof body !== 'object' || body === null) {
      return undefined;
    }
    const error: unknown = (body as { error?: unknown }).error;
    if (typeof error !== 'object' || error === null) {
      return undefined;
    }
    const { code, type } = error as { code?: unknown; type?: unknown };
    const candidate = typeof code === 'string' ? code : type;
    return typeof candidate === 'string' && ERROR_CODE_SHAPE.test(candidate)
      ? candidate
      : undefined;
  }

  private parseRetryAfter(response: Response): number | undefined {
    const header = response.headers.get('retry-after');
    if (header === null) {
      return undefined;
    }
    const seconds = Number(header);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined;
  }

  private assertNotAborted(signal?: AbortSignal): void {
    if (signal?.aborted === true) {
      throw new SemanticTimeoutError('El presupuesto de análisis se agotó antes de la llamada.');
    }
  }

  private createRequestBody(
    input: ModelClassificationInput,
    model: string,
    tier: AnalysisTier,
  ): Readonly<Record<string, unknown>> {
    return {
      model,
      temperature: 0,
      max_output_tokens: this.maxOutputTokens,
      input: [
        {
          role: 'system',
          content: buildSystemInstruction(tier),
        },
        {
          role: 'user',
          content: JSON.stringify(buildModelPayload(input)),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'semantic_classification',
          strict: true,
          schema: buildClassificationSchema(candidateCodesOf(input)),
        },
      },
    };
  }

  private extractOutputText(response: OpenAiResponse): string {
    if (response.output_text !== undefined) {
      return response.output_text;
    }
    const text = response.output
      ?.flatMap((item) => item.content ?? [])
      .find((content) => content.type === 'output_text')?.text;
    if (text === undefined) {
      throw new SemanticProviderError('La respuesta del modelo no contiene salida estructurada.');
    }
    return text;
  }
}

/**
 * Error interno para transportar el código HTTP, su `Retry-After` y el código de
 * error del proveedor hasta la clasificación.
 */
class HttpProviderError extends Error {
  public constructor(
    public readonly status: number,
    public readonly retryAfterMs: number | undefined,
    public readonly code: string | undefined,
  ) {
    super(code === undefined ? `HTTP ${status}` : `HTTP ${status} (${code})`);
    this.name = 'HttpProviderError';
  }
}
