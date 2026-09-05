import {
  AnalysisTier,
  ModelClassification,
  ModelClassificationInput,
  ProviderUsage,
} from '../../domain/semantic-analysis.types';
import { modelClassificationSchema } from '../../domain/semantic-analysis.schemas';
import {
  SemanticConfigurationError,
  SemanticProviderError,
} from '../../domain/semantic-analysis.errors';
import { SemanticModelProvider } from '../../application/ports';
import {
  assertOnlyCandidateCodes,
  buildClassificationSchema,
  buildModelPayload,
  buildSystemInstruction,
  candidateCodesOf,
} from '../model/classification-contract';
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  HttpProviderError,
  OpenAiCompatibleTransport,
  extractMessageContent,
  normalizeBaseUrl,
  parseStructuredOutput,
  readErrorDetail,
  readRetryAfterMs,
} from '../http/openai-compatible-transport';

export interface OpenRouterSemanticProviderOptions {
  /** Credencial DE OPENROUTER. Las de los proveedores físicos viven en su cuenta, no aquí. */
  readonly apiKey: string;
  /** Identificador físico `proveedor/modelo`. Es lo contrario del alias de LiteLLM, y a propósito. */
  readonly fastModel: string;
  readonly deepModel: string;
  readonly baseUrl: string;
  /** `HTTP-Referer` de atribución. Opcional: sin él OpenRouter funciona igual. */
  readonly appUrl?: string;
  /** `X-Title` de atribución. */
  readonly appTitle?: string;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
  readonly maxOutputTokens?: number;
  readonly fetchImplementation?: typeof fetch;
  readonly randomSource?: () => number;
}

interface OpenRouterChatResponse {
  readonly model?: string;
  /** Proveedor físico que atendió la llamada (`OpenAI`, `Anthropic`, `Azure`…). */
  readonly provider?: string;
  readonly choices?: readonly {
    readonly finish_reason?: string;
    readonly message?: {
      readonly content?: unknown;
    };
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly total_tokens?: number;
    /** Coste en USD, sólo cuando la petición pidió `usage: { include: true }`. */
    readonly cost?: unknown;
  };
  /**
   * OpenRouter puede contestar 200 con un error dentro del cuerpo cuando el
   * proveedor físico falló después de que él ya hubiera aceptado la petición.
   */
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
}

/**
 * Adaptador de clasificación estructurada contra **OpenRouter**.
 *
 * Es el mismo papel que `LiteLlmSemanticProvider` —una función especializada
 * detrás del puerto, sin regla de negocio, sin escribir en la base, sin decidir
 * cuándo interviene una persona— con una diferencia de fondo: aquí el motor SÍ
 * nombra el modelo físico. OpenRouter es un enrutador entre proveedores con
 * catálogo público, y su valor es justamente poder elegir `openai/gpt-4.1-mini`
 * hoy y `google/gemini-2.5-flash` mañana sin desplegar nada... siempre que el
 * nombre lo elija alguien desde la configuración y no quede escrito en código.
 *
 * **Por qué `provider.require_parameters`.** Un mismo modelo puede servirlo más
 * de un proveedor físico, y no todos honran `response_format` con esquema
 * estricto. Sin esta bandera OpenRouter enruta por precio o latencia y puede
 * caer en uno que ignore el esquema: la respuesta llega, no es el JSON pedido y
 * la glosa acaba en revisión sin que nada apunte al enrutado. Con ella, sólo se
 * consideran los que aceptan TODOS los parámetros enviados.
 *
 * **Por qué `usage.include`.** OpenRouter calcula el coste real de cada llamada
 * con la tarifa del proveedor que respondió, pero sólo lo devuelve si se le
 * pide. Es el equivalente del `x-litellm-response-cost` y, como allí, nunca se
 * inventa un cero: ausente significa «no lo dijo».
 */
export class OpenRouterSemanticProvider implements SemanticModelProvider {
  private readonly requestFetch: typeof fetch;
  private readonly baseUrl: string;
  private readonly maxOutputTokens: number;
  private readonly transport: OpenAiCompatibleTransport;

  public constructor(private readonly options: OpenRouterSemanticProviderOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new SemanticConfigurationError(
        'OPENROUTER_API_KEY es obligatoria al seleccionar OpenRouterSemanticProvider.',
      );
    }
    this.requestFetch = options.fetchImplementation ?? fetch;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.transport = new OpenAiCompatibleTransport({
      providerLabel: 'OpenRouter',
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
      ...(options.initialBackoffMs === undefined
        ? {}
        : { initialBackoffMs: options.initialBackoffMs }),
      ...(options.maxBackoffMs === undefined ? {} : { maxBackoffMs: options.maxBackoffMs }),
      ...(options.randomSource === undefined ? {} : { randomSource: options.randomSource }),
    });
  }

  /** El identificador físico del nivel: es lo que se pide y lo que se etiqueta. */
  public modelFor(tier: AnalysisTier): string {
    return tier === 'FAST' ? this.options.fastModel : this.options.deepModel;
  }

  public classify(
    input: ModelClassificationInput,
    tier: AnalysisTier,
    signal?: AbortSignal,
  ): Promise<ModelClassification> {
    const model = this.modelFor(tier);
    return this.transport.send(
      (requestSignal) => this.attemptClassification(input, model, tier, requestSignal),
      signal,
    );
  }

  private async attemptClassification(
    input: ModelClassificationInput,
    model: string,
    tier: AnalysisTier,
    signal: AbortSignal,
  ): Promise<ModelClassification> {
    const response = await this.requestFetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.createRequestBody(input, model, tier)),
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

    const providerResponse = (await response.json()) as OpenRouterChatResponse;
    assertNoEmbeddedError(providerResponse);
    const choice = providerResponse.choices?.[0];

    // Mismos dos casos que en el gateway propio, y por las mismas razones:
    // `length` es un JSON a medias que se repite o se amplía; `content_filter`
    // es del proveedor físico y el mismo texto lo volvería a disparar.
    if (choice?.finish_reason === 'length') {
      throw new SemanticProviderError(
        'La respuesta quedó incompleta (max_tokens); considere ampliar OPENROUTER_MAX_OUTPUT_TOKENS.',
        true,
      );
    }
    if (choice?.finish_reason === 'content_filter') {
      throw new SemanticProviderError(
        'El proveedor rechazó la solicitud por su filtro de contenido.',
        false,
      );
    }

    const outputText = extractMessageContent(choice?.message?.content);
    const classification = modelClassificationSchema.parse({
      ...parseStructuredOutput(outputText),
      // Lo PEDIDO frente a lo que RESPONDIÓ. Aquí los dos son físicos, pero no
      // son lo mismo: `provider` dice qué despliegue del modelo atendió, que es
      // lo que hay que mirar cuando un mismo modelo se comporta distinto según
      // el día.
      model,
      modelVersion: respondedBy(providerResponse, model),
      ...usageOf(providerResponse),
    });
    assertOnlyCandidateCodes(classification.assessments, input);
    return classification;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.options.apiKey}`,
      'Content-Type': 'application/json',
      ...(this.options.appUrl === undefined ? {} : { 'HTTP-Referer': this.options.appUrl }),
      ...(this.options.appTitle === undefined ? {} : { 'X-Title': this.options.appTitle }),
    };
  }

  private createRequestBody(
    input: ModelClassificationInput,
    model: string,
    tier: AnalysisTier,
  ): Readonly<Record<string, unknown>> {
    return {
      model,
      temperature: 0,
      max_tokens: this.maxOutputTokens,
      messages: [
        { role: 'system', content: buildSystemInstruction(tier) },
        { role: 'user', content: JSON.stringify(buildModelPayload(input)) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'semantic_classification',
          strict: true,
          schema: buildClassificationSchema(candidateCodesOf(input)),
        },
      },
      provider: { require_parameters: true },
      usage: { include: true },
    };
  }
}

/**
 * Un 200 con `error` dentro es un fallo del proveedor físico que OpenRouter ya
 * no pudo convertir en estado HTTP. Se reconduce por el mismo camino que un
 * error HTTP para que la clasificación en reintentable/permanente sea una sola.
 */
function assertNoEmbeddedError(response: OpenRouterChatResponse): void {
  if (response.error === undefined || response.error === null) return;
  const code = Number(response.error.code);
  const status = Number.isInteger(code) && code >= 400 && code <= 599 ? code : 502;
  throw new HttpProviderError(status, undefined, undefined, false);
}

function respondedBy(response: OpenRouterChatResponse, requested: string): string {
  const model = response.model ?? requested;
  return typeof response.provider === 'string' && response.provider.length > 0
    ? `${model}@${response.provider}`
    : model;
}

function usageOf(response: OpenRouterChatResponse): { usage?: ProviderUsage } {
  const measured: Record<string, number> = {};
  const usage = response.usage;
  if (typeof usage?.prompt_tokens === 'number') measured.inputTokens = usage.prompt_tokens;
  if (typeof usage?.completion_tokens === 'number') measured.outputTokens = usage.completion_tokens;
  if (typeof usage?.total_tokens === 'number') measured.totalTokens = usage.total_tokens;

  const cost = Number(usage?.cost);
  if (usage?.cost !== undefined && Number.isFinite(cost) && cost >= 0)
    measured.estimatedCost = cost;

  return Object.keys(measured).length === 0 ? {} : { usage: measured };
}
