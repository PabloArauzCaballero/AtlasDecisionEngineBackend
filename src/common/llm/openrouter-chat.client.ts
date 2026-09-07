import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  HttpProviderError,
  OpenAiCompatibleTransport,
  type TransportErrors,
  extractMessageContent,
  normalizeBaseUrl,
  parseStructuredOutput,
  readErrorDetail,
  readRetryAfterMs,
} from './openai-compatible-transport';
import { LlmCreditsExhaustedError, LlmProviderError } from './llm-provider.error';

/**
 * Cliente de conversación estructurada contra **OpenRouter**, sin dominio.
 *
 * Nace de tener TRES consumidores con la misma necesidad y ninguna regla de
 * negocio en común: el árbitro de la franja de duda de identidad, el segundo
 * lector de campos del carnet y el asistente de columnas de un extracto de un
 * banco sin plantilla propia. Los tres piden lo mismo —un JSON que cumpla un
 * esquema, con o sin imágenes— y los tres necesitan la misma respuesta cuando
 * algo falla.
 *
 * **Qué NO hace, a propósito:**
 *
 * - No decide nada. Devuelve lo que el modelo propuso; quien llamó lo verifica
 *   contra algo determinista —el dígito de control de la MRZ, el saldo corriente
 *   de un extracto— antes de darle valor. Un cliente que interpretara sería el
 *   sitio equivocado para poner esa confianza.
 * - No degrada un fallo a silencio. Si no se puede llamar, lanza; y si el motivo
 *   es que no quedan créditos, lanza `LlmCreditsExhaustedError`, que es una
 *   clase distinta justamente para que no se confunda con «el modelo dijo que
 *   no». Quien llame decide qué hacer con eso, pero no puede no enterarse.
 *
 * `OpenRouterSemanticProvider` no se reescribió sobre esta clase: tiene su
 * propio contrato de clasificación, su caché de sondas y sus pruebas, y
 * fusionarlos habría mezclado dos ciclos de cambio por ahorrar una llamada a
 * `fetch`. Lo que sí comparten —el transporte y la lectura de un saldo agotado—
 * ya está compartido.
 */

/** La taxonomía genérica, con el saldo agotado como clase propia. */
const CHAT_ERRORS: TransportErrors = {
  provider: (message, retryable, options) => new LlmProviderError(message, retryable, options),
  budgetExhausted: (message, options) => new LlmProviderError(message, false, options),
  classified: (error) =>
    error instanceof LlmProviderError ? { retryable: error.retryable } : undefined,
  quotaExhausted: (message, options) => new LlmCreditsExhaustedError(message, options),
};

export interface OpenRouterChatOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  /** Identificador físico `proveedor/modelo`. */
  readonly model: string;
  readonly appUrl?: string;
  readonly appTitle?: string;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly maxOutputTokens?: number;
  readonly fetchImplementation?: typeof fetch;
}

export interface OpenRouterChatRequest {
  readonly system: string;
  readonly user: string;
  /**
   * Imágenes como `data:` URL. Sólo las admiten los modelos multimodales; con
   * uno de texto, OpenRouter contesta 400 y el fallo es del despliegue, no del
   * documento.
   */
  readonly images?: readonly string[];
  readonly schemaName: string;
  readonly schema: Record<string, unknown>;
}

export interface OpenRouterUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly estimatedCost?: number;
}

export interface OpenRouterChatResult {
  readonly output: Record<string, unknown>;
  /** Modelo pedido y despliegue físico que respondió (`modelo@Proveedor`). */
  readonly respondedBy: string;
  readonly usage: OpenRouterUsage;
}

/** Lo que `GET /key` dice del saldo, para un `health()` que no gasta tokens. */
export interface OpenRouterCredits {
  readonly ok: boolean;
  readonly detail: string;
  /** `undefined` cuando la cuenta no tiene tope declarado (prepago sin límite). */
  readonly remaining?: number;
}

interface ChatResponse {
  readonly model?: string;
  readonly provider?: string;
  readonly choices?: readonly {
    readonly finish_reason?: string;
    readonly message?: { readonly content?: unknown };
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly cost?: unknown;
  };
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
}

export class OpenRouterChatClient {
  private readonly baseUrl: string;
  private readonly requestFetch: typeof fetch;
  private readonly transport: OpenAiCompatibleTransport;
  private readonly maxOutputTokens: number;

  public constructor(private readonly options: OpenRouterChatOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new LlmProviderError('OPENROUTER_API_KEY es obligatoria para OpenRouterChatClient.');
    }
    if (options.model.trim().length === 0) {
      throw new LlmProviderError('OpenRouterChatClient necesita un modelo físico.');
    }
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? 'https://openrouter.ai/api/v1');
    this.requestFetch = options.fetchImplementation ?? fetch;
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.transport = new OpenAiCompatibleTransport({
      providerLabel: 'OpenRouter',
      errors: CHAT_ERRORS,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
    });
  }

  public get model(): string {
    return this.options.model;
  }

  public complete(request: OpenRouterChatRequest, budget?: AbortSignal): Promise<OpenRouterChatResult> {
    return this.transport.send((signal) => this.attempt(request, signal), budget);
  }

  /**
   * Estado de la credencial y del saldo, con `GET /key`.
   *
   * Se mira aquí y no con una clasificación de prueba porque una llamada de
   * humo cuesta tokens cada vez que alguien abre el tablero, y porque este
   * extremo distingue las dos cosas que hay que distinguir: la clave no vale
   * (401) frente a la clave vale pero no queda saldo.
   */
  public async credits(): Promise<OpenRouterCredits> {
    let response: Response;
    try {
      response = await this.requestFetch(`${this.baseUrl}/key`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.options.apiKey}` },
        signal: AbortSignal.timeout(this.transport.requestTimeoutMs),
      });
    } catch {
      return { ok: false, detail: 'no se pudo contactar con OpenRouter' };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, detail: 'OPENROUTER_API_KEY rechazada por OpenRouter' };
    }
    if (!response.ok) {
      return { ok: false, detail: `OpenRouter respondió HTTP ${String(response.status)} a GET /key` };
    }

    const body = (await response.json().catch(() => ({}))) as {
      data?: { limit_remaining?: unknown; limit?: unknown; usage?: unknown };
    };
    const remaining = Number(body.data?.limit_remaining);
    if (Number.isFinite(remaining)) {
      return remaining > 0
        ? { ok: true, detail: `saldo restante ${remaining.toFixed(4)} USD`, remaining }
        : { ok: false, detail: 'sin créditos en OpenRouter', remaining };
    }
    // Sin tope declarado: la cuenta es de prepago y `limit_remaining` viene
    // nulo. No se puede afirmar que haya saldo, pero tampoco que no lo haya, y
    // decir «sin créditos» aquí apagaría un despliegue sano.
    return { ok: true, detail: 'credencial válida; la cuenta no declara tope de gasto' };
  }

  private async attempt(
    request: OpenRouterChatRequest,
    signal: AbortSignal,
  ): Promise<OpenRouterChatResult> {
    const response = await this.requestFetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
        ...(this.options.appUrl === undefined ? {} : { 'HTTP-Referer': this.options.appUrl }),
        ...(this.options.appTitle === undefined ? {} : { 'X-Title': this.options.appTitle }),
      },
      body: JSON.stringify(this.body(request)),
      signal,
    });

    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new HttpProviderError(
        response.status,
        readRetryAfterMs(response),
        detail.code,
        detail.quotaExhausted,
      );
    }

    const body = (await response.json()) as ChatResponse;
    assertNoEmbeddedError(body);
    const choice = body.choices?.[0];
    if (choice?.finish_reason === 'length') {
      throw new LlmProviderError('La respuesta quedó incompleta (max_tokens).', true);
    }
    if (choice?.finish_reason === 'content_filter') {
      throw new LlmProviderError('El proveedor rechazó la solicitud por su filtro de contenido.');
    }

    return {
      output: parseStructuredOutput(extractMessageContent(choice?.message?.content, CHAT_ERRORS), CHAT_ERRORS),
      respondedBy: respondedBy(body, this.options.model),
      usage: usageOf(body),
    };
  }

  private body(request: OpenRouterChatRequest): Readonly<Record<string, unknown>> {
    const images = request.images ?? [];
    const userContent =
      images.length === 0
        ? request.user
        : [
            { type: 'text', text: request.user },
            ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
          ];

    return {
      model: this.options.model,
      temperature: 0,
      max_tokens: this.maxOutputTokens,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: userContent },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: request.schemaName, strict: true, schema: request.schema },
      },
      // Sin esto OpenRouter enruta por precio y puede caer en un proveedor que
      // ignore el esquema: llega una respuesta, no es la pedida, y nada apunta
      // al enrutado. Ver `OpenRouterSemanticProvider`, donde se midió.
      provider: { require_parameters: true },
      usage: { include: true },
    };
  }
}

function assertNoEmbeddedError(response: ChatResponse): void {
  if (response.error === undefined || response.error === null) return;
  const code = Number(response.error.code);
  const status = Number.isInteger(code) && code >= 400 && code <= 599 ? code : 502;
  throw new HttpProviderError(status, undefined, undefined, false);
}

function respondedBy(response: ChatResponse, requested: string): string {
  const model = response.model ?? requested;
  return typeof response.provider === 'string' && response.provider.length > 0
    ? `${model}@${response.provider}`
    : model;
}

function usageOf(response: ChatResponse): OpenRouterUsage {
  const usage: { inputTokens?: number; outputTokens?: number; estimatedCost?: number } = {};
  if (typeof response.usage?.prompt_tokens === 'number')
    usage.inputTokens = response.usage.prompt_tokens;
  if (typeof response.usage?.completion_tokens === 'number')
    usage.outputTokens = response.usage.completion_tokens;
  const cost = Number(response.usage?.cost);
  if (Number.isFinite(cost) && cost >= 0) usage.estimatedCost = cost;
  return usage;
}
