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
  normalizeBaseUrl,
  parseStructuredOutput,
  readErrorCode,
  readRetryAfterMs,
} from '../http/openai-compatible-transport';

export interface LiteLlmSemanticProviderOptions {
  /** Credencial DEL GATEWAY. Las de los proveedores físicos no llegan a este proceso. */
  readonly apiKey: string;
  /** Alias lógico del `model_list` de LiteLLM, nunca un modelo físico. */
  readonly fastModel: string;
  readonly deepModel: string;
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
  readonly maxOutputTokens?: number;
  readonly fetchImplementation?: typeof fetch;
  readonly randomSource?: () => number;
}

interface LiteLlmChatResponse {
  readonly model?: string;
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
  };
  /** Extensión de LiteLLM: coste calculado por el gateway para esta llamada. */
  readonly _hidden_params?: { readonly response_cost?: unknown };
}

/**
 * Adaptador de clasificación estructurada contra un **LiteLLM Proxy**.
 *
 * El gateway es una función especializada detrás del puerto, no el cerebro del
 * sistema: aquí no se decide ninguna regla de negocio, no se crean categorías,
 * no se escribe en la base y no se decide cuándo interviene una persona. Todo
 * eso ya vive donde vivía —`DecisionEngine`, `GlosaFallbackClassifier` y el
 * `UnresolvedSink`— y este adaptador sólo puede hacer dos cosas: devolver una
 * clasificación válida, o fallar de una forma que el pipeline ya sabe convertir
 * en revisión humana.
 *
 * **Por qué `chat/completions` y no `responses`.** LiteLLM traduce la interfaz
 * de chat a todos sus proveedores; la Responses API sólo la reexpone para
 * algunos. Elegirla habría atado el alias lógico a un subconjunto de proveedores
 * y roto justo lo que el gateway existe para dar: cambiar de modelo por debajo
 * sin tocar este código.
 *
 * **Por qué no hereda de `OpenAiSemanticProvider`.** El contrato de clasificación
 * —prompt, esquema de salida y validación de códigos— se comparte de verdad, y
 * está en `classification-contract`. Lo demás (la forma del cuerpo, dónde está
 * la salida, cómo se declara el consumo) es distinto en cada API, y una herencia
 * lo habría escondido detrás de tres `override`.
 */
export class LiteLlmSemanticProvider implements SemanticModelProvider {
  private readonly requestFetch: typeof fetch;
  private readonly baseUrl: string;
  private readonly maxOutputTokens: number;
  private readonly transport: OpenAiCompatibleTransport;

  public constructor(private readonly options: LiteLlmSemanticProviderOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new SemanticConfigurationError(
        'LITELLM_API_KEY es obligatoria al seleccionar LiteLlmSemanticProvider.',
      );
    }
    this.requestFetch = options.fetchImplementation ?? fetch;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.transport = new OpenAiCompatibleTransport({
      providerLabel: 'LiteLLM',
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
      ...(options.initialBackoffMs === undefined
        ? {}
        : { initialBackoffMs: options.initialBackoffMs }),
      ...(options.maxBackoffMs === undefined ? {} : { maxBackoffMs: options.maxBackoffMs }),
      ...(options.randomSource === undefined ? {} : { randomSource: options.randomSource }),
    });
  }

  /** El alias lógico del nivel. Nunca el modelo físico que haya detrás. */
  public modelFor(tier: AnalysisTier): string {
    return tier === 'FAST' ? this.options.fastModel : this.options.deepModel;
  }

  public classify(
    input: ModelClassificationInput,
    tier: AnalysisTier,
    signal?: AbortSignal,
  ): Promise<ModelClassification> {
    const alias = this.modelFor(tier);
    return this.transport.send(
      (requestSignal) => this.attemptClassification(input, alias, tier, requestSignal),
      signal,
    );
  }

  private async attemptClassification(
    input: ModelClassificationInput,
    alias: string,
    tier: AnalysisTier,
    signal: AbortSignal,
  ): Promise<ModelClassification> {
    const response = await this.requestFetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(this.createRequestBody(input, alias, tier)),
      signal,
    });

    if (!response.ok) {
      throw new HttpProviderError(
        response.status,
        readRetryAfterMs(response),
        await readErrorCode(response),
      );
    }

    const headerCost = costFromHeader(response);
    const providerResponse = (await response.json()) as LiteLlmChatResponse;
    const choice = providerResponse.choices?.[0];

    /*
     * `length` significa que el modelo se quedó a medias, no que se equivocara:
     * el JSON llega truncado y parsearlo daría un error de sintaxis que se
     * clasificaría como fallo de contrato —permanente— cuando en realidad basta
     * con repetir o subir el techo de salida.
     */
    if (choice?.finish_reason === 'length') {
      throw new SemanticProviderError(
        'La respuesta quedó incompleta (max_tokens); considere ampliar LITELLM_MAX_OUTPUT_TOKENS.',
        true,
      );
    }
    /*
     * `content_filter` es del proveedor físico y NO se reintenta: el mismo texto
     * volvería a dispararlo, y tres intentos sólo retrasan la revisión humana
     * que ya es el desenlace correcto para una glosa que nadie va a clasificar.
     */
    if (choice?.finish_reason === 'content_filter') {
      throw new SemanticProviderError(
        'El proveedor rechazó la solicitud por su filtro de contenido.',
        false,
      );
    }

    const outputText = extractContent(choice?.message?.content);
    const classification = modelClassificationSchema.parse({
      ...parseStructuredOutput(outputText),
      // Lo PEDIDO frente a lo que RESPONDIÓ: el alias mantiene acotada la
      // etiqueta de las métricas y el modelo devuelto delata si contestó el
      // despliegue primario o su suplente.
      model: alias,
      modelVersion: providerResponse.model ?? alias,
      ...usageOf(providerResponse, headerCost),
    });
    assertOnlyCandidateCodes(classification.assessments, input);
    return classification;
  }

  private createRequestBody(
    input: ModelClassificationInput,
    alias: string,
    tier: AnalysisTier,
  ): Readonly<Record<string, unknown>> {
    return {
      model: alias,
      // Clasificar no es escribir: la variabilidad aquí sólo produce que la misma
      // glosa caiga hoy en una categoría y mañana en otra.
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
    };
  }
}

/**
 * El texto de la respuesta, admitiendo las dos formas que llegan del gateway.
 *
 * LiteLLM normaliza a cadena para casi todos sus proveedores, pero los que
 * devuelven bloques de contenido (Anthropic, Vertex) pueden atravesarlo como
 * lista. Rechazar la lista dejaría el alias lógico funcionando con un proveedor
 * y roto con su suplente, que es exactamente el fallo que el gateway existe para
 * evitar y el que sólo se manifiesta durante una caída.
 */
function extractContent(content: unknown): string {
  if (typeof content === 'string' && content.trim().length > 0) {
    return content;
  }
  if (Array.isArray(content)) {
    const text = content
      .filter((part): part is { text: string } => isTextPart(part))
      .map((part) => part.text)
      .join('');
    if (text.trim().length > 0) return text;
  }
  throw new SemanticProviderError('La respuesta del modelo no contiene salida estructurada.');
}

function isTextPart(part: unknown): part is { text: string } {
  return (
    typeof part === 'object' &&
    part !== null &&
    typeof (part as { text?: unknown }).text === 'string'
  );
}

/**
 * Lo que costó la llamada, según el gateway.
 *
 * Es la razón principal para poner LiteLLM por delante y no cada SDK por su
 * cuenta: el coste lo calcula quien conoce la tarifa del proveedor físico, y
 * aquí sólo se transporta. Nunca se inventa un cero — ausente significa «no lo
 * dijo», que es lo que hay que investigar si el panel de coste se queda plano.
 */
function usageOf(
  response: LiteLlmChatResponse,
  headerCost: number | undefined,
): { usage?: ProviderUsage } {
  const measured: Record<string, number> = {};
  const usage = response.usage;
  if (typeof usage?.prompt_tokens === 'number') measured.inputTokens = usage.prompt_tokens;
  if (typeof usage?.completion_tokens === 'number') measured.outputTokens = usage.completion_tokens;
  if (typeof usage?.total_tokens === 'number') measured.totalTokens = usage.total_tokens;

  const bodyCost = Number(response._hidden_params?.response_cost);
  const cost = Number.isFinite(bodyCost) ? bodyCost : headerCost;
  if (cost !== undefined && Number.isFinite(cost) && cost >= 0) measured.estimatedCost = cost;

  return Object.keys(measured).length === 0 ? {} : { usage: measured };
}

function costFromHeader(response: Response): number | undefined {
  const header = response.headers.get('x-litellm-response-cost');
  if (header === null) return undefined;
  const cost = Number(header);
  return Number.isFinite(cost) && cost >= 0 ? cost : undefined;
}
