import {
  AnalysisTier,
  ModelClassification,
  ModelClassificationInput,
} from '../../domain/semantic-analysis.types';
import { modelClassificationSchema } from '../../domain/semantic-analysis.schemas';
import {
  SemanticConfigurationError,
  SemanticProviderError,
} from '../../domain/semantic-analysis.errors';
import { SemanticModelProvider } from '../../application/ports';
import {
  assertOnlyCandidateCodes,
  buildModelPayload,
  buildSystemInstruction,
  buildClassificationSchema,
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
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly total_tokens?: number;
  };
  readonly output?: readonly {
    readonly content?: readonly { readonly type?: string; readonly text?: string }[];
  }[];
}

/**
 * Adaptador aislado para clasificación estructurada mediante OpenAI Responses API.
 *
 * La política de reintentos, los plazos y la traducción de fallos viven en
 * `OpenAiCompatibleTransport`, compartida con el adaptador de LiteLLM: aquí
 * queda sólo lo propio de la Responses API —la forma del cuerpo y dónde está la
 * salida estructurada—.
 */
export class OpenAiSemanticProvider implements SemanticModelProvider {
  private readonly requestFetch: typeof fetch;
  private readonly baseUrl: string;
  private readonly maxOutputTokens: number;
  private readonly transport: OpenAiCompatibleTransport;

  public constructor(private readonly options: OpenAiSemanticProviderOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new SemanticConfigurationError(
        'OPENAI_API_KEY es obligatoria al seleccionar OpenAiSemanticProvider.',
      );
    }
    this.requestFetch = options.fetchImplementation ?? fetch;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? 'https://api.openai.com/v1');
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.transport = new OpenAiCompatibleTransport({
      providerLabel: 'OpenAI',
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxAttempts === undefined ? {} : { maxAttempts: options.maxAttempts }),
      ...(options.initialBackoffMs === undefined
        ? {}
        : { initialBackoffMs: options.initialBackoffMs }),
      ...(options.maxBackoffMs === undefined ? {} : { maxBackoffMs: options.maxBackoffMs }),
      ...(options.randomSource === undefined ? {} : { randomSource: options.randomSource }),
    });
  }

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
    const response = await this.requestFetch(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(this.createRequestBody(input, model, tier)),
      signal,
    });

    if (!response.ok) {
      throw new HttpProviderError(
        response.status,
        readRetryAfterMs(response),
        await readErrorCode(response),
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
    const parsedOutput = parseStructuredOutput(outputText);
    const classification = modelClassificationSchema.parse({
      ...parsedOutput,
      model: providerResponse.model ?? model,
      modelVersion: providerResponse.model ?? model,
      ...usageOf(providerResponse),
    });
    assertOnlyCandidateCodes(classification.assessments, input);
    return classification;
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

/** Consumo declarado por el proveedor, si lo declaró. Nunca inventa ceros. */
function usageOf(response: OpenAiResponse): { usage?: Record<string, number> } {
  const usage = response.usage;
  if (usage === undefined) return {};
  const measured: Record<string, number> = {};
  if (typeof usage.input_tokens === 'number') measured.inputTokens = usage.input_tokens;
  if (typeof usage.output_tokens === 'number') measured.outputTokens = usage.output_tokens;
  if (typeof usage.total_tokens === 'number') measured.totalTokens = usage.total_tokens;
  return Object.keys(measured).length === 0 ? {} : { usage: measured };
}
