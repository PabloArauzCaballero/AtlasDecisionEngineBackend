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

export interface OllamaSemanticProviderOptions {
  readonly fastModel: string;
  readonly deepModel: string;
  /** Raíz del servidor Ollama, **sin** `/v1`: este adaptador usa la API nativa `/api/chat`. */
  readonly baseUrl?: string;
  /** Sólo para instancias publicadas tras un proxy autenticado; Ollama local no exige credencial. */
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  /** Intentos adicionales ante fallos transitorios; `1` desactiva el reintento. */
  readonly maxAttempts?: number;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
  /** `num_predict`. Es el principal determinante de la latencia en generación local. */
  readonly maxOutputTokens?: number;
  /** `num_ctx`. Debe cubrir el catálogo de candidatos completo; ver nota sobre truncado silencioso. */
  readonly contextTokens?: number;
  /** `keep_alive`: cuánto permanece el modelo residente en memoria entre trabajos. */
  readonly keepAlive?: string;
  /**
   * Desactiva la cadena de razonamiento en modelos que la soportan (qwen3, deepseek-r1).
   * Sólo se envía cuando está definido: los modelos sin esa capacidad rechazan el campo con 400.
   */
  readonly think?: boolean;
  /** Fija la semilla de muestreo. Útil para que un conjunto de evaluación sea reproducible. */
  readonly seed?: number;
  readonly fetchImplementation?: typeof fetch;
  /** Inyectable para hacer determinista el jitter en pruebas. */
  readonly randomSource?: () => number;
}

interface OllamaChatResponse {
  readonly model?: string;
  readonly done_reason?: string;
  readonly message?: { readonly content?: string };
  readonly error?: string;
}

const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_INITIAL_BACKOFF_MS = 500;
const DEFAULT_MAX_BACKOFF_MS = 8_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 1_536;
const DEFAULT_CONTEXT_TOKENS = 8_192;
const DEFAULT_KEEP_ALIVE = '30m';

/** Límites del esquema de dominio que la gramática de Ollama no impone por sí sola. */
const MAX_EVIDENCE_ITEMS = 10;
const MAX_EVIDENCE_LENGTH = 500;
const MAX_RATIONALE_LENGTH = 1_000;

/**
 * Adaptador de clasificación estructurada sobre un servidor Ollama.
 *
 * Se apoya en la API nativa `/api/chat` en lugar de la capa compatible con OpenAI porque necesita
 * tres cosas que aquélla no expone con fidelidad: `format` con un esquema JSON completo —que
 * llama.cpp convierte en una gramática de decodificación—, `num_ctx` y `keep_alive`.
 *
 * Difiere del adaptador de OpenAI en dos puntos deliberados:
 *
 * 1. **Coerción de la salida.** La gramática garantiza la *forma* (tipos, claves, obligatoriedad)
 *    pero no los rangos: `minimum`, `maximum` y `maxItems` no llegan a la gramática. Un modelo
 *    pequeño devuelve con frecuencia `confidence: 1.4` o quince evidencias, y eso haría fallar la
 *    validación de dominio en algo que es ruido de formato, no un error de criterio. Se ajusta
 *    antes de validar; lo que sí es un error de criterio —una categoría no candidata— se rechaza.
 * 2. **Menos reintentos por defecto.** Ante un servidor local no hay cuota ni congestión de red que
 *    justifique insistir, y cada intento consume el presupuesto de un análisis mucho más lento.
 */
export class OllamaSemanticProvider implements SemanticModelProvider {
  private readonly requestTimeoutMs: number;
  private readonly requestFetch: typeof fetch;
  private readonly baseUrl: string;
  private readonly maxAttempts: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly maxOutputTokens: number;
  private readonly contextTokens: number;
  private readonly keepAlive: string;
  private readonly randomSource: () => number;

  public constructor(private readonly options: OllamaSemanticProviderOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.requestTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.requestFetch = options.fetchImplementation ?? fetch;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.contextTokens = options.contextTokens ?? DEFAULT_CONTEXT_TOKENS;
    this.keepAlive = options.keepAlive ?? DEFAULT_KEEP_ALIVE;
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
        const providerError = this.toProviderError(error, model, signal);
        if (!providerError.retryable || attempt === this.maxAttempts) {
          throw providerError;
        }
        lastError = providerError;
        await this.waitBeforeRetry(attempt, signal);
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

    const response = await this.requestFetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.options.apiKey === undefined
          ? {}
          : { Authorization: `Bearer ${this.options.apiKey}` }),
      },
      body: JSON.stringify(this.createRequestBody(input, model, tier)),
      signal: combined,
    });

    if (!response.ok) {
      throw new HttpProviderError(response.status);
    }

    const providerResponse = (await response.json()) as OllamaChatResponse;
    // Ollama trunca en silencio al agotar `num_predict`: sin esta comprobación el JSON incompleto
    // se reportaría como una salida malformada y no se reintentaría.
    if (providerResponse.done_reason === 'length') {
      throw new SemanticProviderError(
        `La generación se truncó al alcanzar num_predict (${String(this.maxOutputTokens)} tokens).`,
        true,
      );
    }

    const parsedOutput = this.parseJson(providerResponse.message?.content);
    const classification = modelClassificationSchema.parse({
      ...coerceToDomainLimits(parsedOutput),
      model: providerResponse.model ?? model,
      modelVersion: providerResponse.model ?? model,
    });
    assertOnlyCandidateCodes(classification.assessments, input);
    return classification;
  }

  private parseJson(content: string | undefined): Record<string, unknown> {
    if (content === undefined || content.trim().length === 0) {
      throw new SemanticProviderError('La respuesta del modelo no contiene salida estructurada.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripCodeFence(content));
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
   *
   * El `404` merece trato propio: en un servidor alojado indica una ruta inexistente, pero en
   * Ollama significa casi siempre que el modelo no está descargado, y ese diagnóstico ahorra una
   * búsqueda a quien despliega.
   */
  private toProviderError(
    error: unknown,
    model: string,
    signal?: AbortSignal,
  ): SemanticProviderError {
    if (error instanceof SemanticProviderError) {
      return error;
    }
    if (error instanceof HttpProviderError) {
      if (error.status === 404) {
        return new SemanticProviderError(
          `Ollama no reconoce el modelo "${model}". Descárguelo con \`ollama pull ${model}\`.`,
          false,
        );
      }
      return new SemanticProviderError(
        `Ollama respondió con HTTP ${String(error.status)}.`,
        RETRYABLE_STATUS_CODES.has(error.status),
      );
    }
    if (signal?.aborted === true) {
      return new SemanticProviderError(
        'El análisis fue abortado por presupuesto de tiempo.',
        false,
        { cause: error },
      );
    }
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return new SemanticProviderError(
        `La llamada al proveedor superó ${String(this.requestTimeoutMs)} ms.`,
        true,
        { cause: error },
      );
    }
    // Ollama caído o inalcanzable llega aquí. La URL no es un secreto y orienta el diagnóstico.
    return new SemanticProviderError(
      `No fue posible contactar con Ollama en ${this.baseUrl}.`,
      true,
      { cause: error },
    );
  }

  private async waitBeforeRetry(attempt: number, signal?: AbortSignal): Promise<void> {
    const exponential = Math.min(this.initialBackoffMs * 2 ** (attempt - 1), this.maxBackoffMs);
    const waitMs = Math.round(exponential * (0.5 + this.randomSource() * 0.5));
    try {
      await delay(waitMs, undefined, { signal });
    } catch (error: unknown) {
      throw new SemanticTimeoutError('El presupuesto se agotó durante la espera de reintento.', {
        cause: error,
      });
    }
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
      stream: false,
      keep_alive: this.keepAlive,
      format: buildClassificationSchema(candidateCodesOf(input)),
      ...(this.options.think === undefined ? {} : { think: this.options.think }),
      options: {
        temperature: 0,
        num_predict: this.maxOutputTokens,
        num_ctx: this.contextTokens,
        ...(this.options.seed === undefined ? {} : { seed: this.options.seed }),
      },
      messages: [
        { role: 'system', content: buildSystemInstruction(tier) },
        { role: 'user', content: JSON.stringify(buildModelPayload(input)) },
      ],
    };
  }
}

/**
 * Ajusta la salida a los límites del esquema de dominio.
 *
 * Se limita a recortar y acotar: nunca inventa un campo ausente ni corrige un tipo. Si el modelo
 * omitió `assessments` o devolvió una confianza no numérica, el error llega intacto a la
 * validación, que es donde debe fallar.
 */
function coerceToDomainLimits(payload: Record<string, unknown>): Record<string, unknown> {
  const { assessments } = payload;
  if (!Array.isArray(assessments)) {
    return payload;
  }
  return {
    ...payload,
    assessments: assessments.map((assessment: unknown) => {
      if (typeof assessment !== 'object' || assessment === null) {
        return assessment;
      }
      const entry = assessment as Record<string, unknown>;
      return {
        ...entry,
        ...(typeof entry['confidence'] === 'number' && Number.isFinite(entry['confidence'])
          ? { confidence: Math.min(Math.max(entry['confidence'], 0), 1) }
          : {}),
        ...(Array.isArray(entry['evidence'])
          ? {
              evidence: entry['evidence']
                .slice(0, MAX_EVIDENCE_ITEMS)
                .map((item: unknown) =>
                  typeof item === 'string' ? item.slice(0, MAX_EVIDENCE_LENGTH) : item,
                ),
            }
          : {}),
        ...(typeof entry['rationale'] === 'string'
          ? { rationale: entry['rationale'].slice(0, MAX_RATIONALE_LENGTH) }
          : {}),
      };
    }),
  };
}

/**
 * Retira el vallado markdown que algunos modelos añaden pese a la gramática.
 *
 * No debería ocurrir con `format` activo, pero cuesta tres líneas y evita convertir una respuesta
 * correcta en un fallo permanente.
 */
function stripCodeFence(content: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n?\s*```\s*$/u.exec(content);
  return fenced?.[1] ?? content;
}

/**
 * Rechaza la URL de la capa compatible con OpenAI.
 *
 * Es el error de configuración más probable al migrar desde el adaptador de OpenAI: `…:11434/v1`
 * responde en `/v1/chat/completions`, no en `/api/chat`, y el fallo resultante —un 404 -
 * parecería un modelo no descargado.
 */
function normalizeBaseUrl(baseUrl: string | undefined): string {
  const normalized = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, '');
  if (normalized.endsWith('/v1')) {
    throw new SemanticConfigurationError(
      'OLLAMA_BASE_URL debe apuntar a la raíz del servidor (por ejemplo http://127.0.0.1:11434), ' +
        'no a la capa compatible con OpenAI: este adaptador usa la API nativa /api/chat.',
    );
  }
  return normalized;
}

/** Error interno para transportar el código HTTP hasta la clasificación del fallo. */
class HttpProviderError extends Error {
  public constructor(public readonly status: number) {
    super(`HTTP ${String(status)}`);
    this.name = 'HttpProviderError';
  }
}
