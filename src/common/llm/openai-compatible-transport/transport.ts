import { setTimeout as delay } from 'node:timers/promises';
import {
  DEFAULT_INITIAL_BACKOFF_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_BACKOFF_MS,
  DEFAULT_TIMEOUT_MS,
} from './defaults';
import {
  CREDITS_EXHAUSTED_CODES,
  PAYMENT_REQUIRED_STATUS,
  PERMANENT_ERROR_CODES,
  RETRYABLE_STATUS_CODES,
} from './error-signatures';
import {
  DEFAULT_TRANSPORT_ERRORS,
  HttpProviderError,
  type TransportErrors,
} from './provider-errors';

export interface TransportOptions {
  /** Nombre que aparece en el mensaje de error. Nunca lleva credenciales ni URLs. */
  readonly providerLabel: string;
  readonly timeoutMs?: number;
  /** `1` desactiva el reintento. */
  readonly maxAttempts?: number;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
  /** Inyectable para hacer determinista el jitter en pruebas. */
  readonly randomSource?: () => number;
  /** Taxonomía de errores del módulo que llama. Por omisión, la de `common`. */
  readonly errors?: TransportErrors;
}

/**
 * Ejecuta un intento contra una API compatible con OpenAI y reintenta sólo lo
 * transitorio, con retroceso exponencial con jitter y respetando `Retry-After`.
 *
 * Los errores de contrato — esquema inválido, categoría fuera del conjunto
 * candidato, credenciales rechazadas — no se reintentan: repetirlos gasta cuota
 * para llegar a la misma respuesta.
 */
export class OpenAiCompatibleTransport {
  public readonly requestTimeoutMs: number;
  private readonly providerLabel: string;
  private readonly maxAttempts: number;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly randomSource: () => number;
  private readonly errors: TransportErrors;

  public constructor(options: TransportOptions) {
    this.providerLabel = options.providerLabel;
    this.requestTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.randomSource = options.randomSource ?? Math.random;
    this.errors = options.errors ?? DEFAULT_TRANSPORT_ERRORS;
  }

  /**
   * @param attempt - Recibe el `AbortSignal` que combina el plazo de ESTA
   *   petición con el presupuesto del análisis completo. El primero que venza
   *   corta la llamada, de modo que ni un intento colgado ni la suma de los
   *   reintentos pueden rebasar el presupuesto del job.
   * @param budget - Presupuesto de tiempo del análisis, si lo hay.
   */
  public async send<T>(
    attempt: (signal: AbortSignal) => Promise<T>,
    budget?: AbortSignal,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attemptNumber = 1; attemptNumber <= this.maxAttempts; attemptNumber += 1) {
      this.assertNotAborted(budget);
      try {
        return await attempt(this.signalFor(budget));
      } catch (error: unknown) {
        const failure = this.classify(error, budget);
        if (!failure.retryable || attemptNumber === this.maxAttempts) {
          throw failure.error;
        }
        lastError = failure.error;
        await this.waitBeforeRetry(attemptNumber, retryAfterMsOf(error), budget);
      }
    }

    throw lastError ?? this.errors.provider('No fue posible completar la llamada.', true);
  }

  private signalFor(budget?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.requestTimeoutMs);
    return budget === undefined ? timeout : AbortSignal.any([budget, timeout]);
  }

  /**
   * Clasifica cualquier fallo en reintentable o permanente sin filtrar el
   * contenido analizado.
   *
   * Devuelve el error JUNTO a su clasificación en vez de fiarse de una
   * propiedad del error: quien inyecta su taxonomía no tiene por qué publicar un
   * `retryable`, y el transporte necesita el dato para decidir si reintenta.
   */
  private classify(
    error: unknown,
    budget?: AbortSignal,
  ): { readonly error: Error; readonly retryable: boolean } {
    // Ya clasificado por el propio intento: se devuelve tal cual. Envolverlo
    // otra vez perdería su mensaje, que es el único que sabe qué pasó.
    const yaClasificado = this.errors.classified(error);
    if (yaClasificado !== undefined) {
      return { error: error as Error, retryable: yaClasificado.retryable };
    }
    if (error instanceof HttpProviderError) {
      const retryable =
        RETRYABLE_STATUS_CODES.has(error.status) &&
        !(error.code !== undefined && PERMANENT_ERROR_CODES.has(error.code)) &&
        !error.quotaExhausted;
      const detail = error.code === undefined ? '' : ` (${error.code})`;
      const mensaje = `${this.providerLabel} respondió con HTTP ${String(error.status)}${detail}.`;
      if (this.errors.quotaExhausted !== undefined && saysCreditsExhausted(error)) {
        return { error: this.errors.quotaExhausted(mensaje), retryable: false };
      }
      return { error: this.errors.provider(mensaje, retryable), retryable };
    }
    if (budget?.aborted === true) {
      return {
        error: this.errors.provider('La llamada fue abortada por presupuesto de tiempo.', false, {
          cause: error,
        }),
        retryable: false,
      };
    }
    if (isTimeout(error)) {
      return {
        error: this.errors.provider(
          `La llamada al proveedor superó ${String(this.requestTimeoutMs)} ms.`,
          true,
          { cause: error },
        ),
        retryable: true,
      };
    }
    // Fallos de red y de DNS llegan aquí; son transitorios por defecto.
    return {
      error: this.errors.provider('No fue posible completar la llamada al proveedor.', true, {
        cause: error,
      }),
      retryable: true,
    };
  }

  private async waitBeforeRetry(
    attempt: number,
    retryAfterMs: number | undefined,
    budget?: AbortSignal,
  ): Promise<void> {
    const exponential = Math.min(this.initialBackoffMs * 2 ** (attempt - 1), this.maxBackoffMs);
    const jittered = Math.round(exponential * (0.5 + this.randomSource() * 0.5));
    const waitMs = Math.min(Math.max(retryAfterMs ?? jittered, 0), this.maxBackoffMs);
    try {
      await delay(waitMs, undefined, { signal: budget });
    } catch (error: unknown) {
      throw this.errors.budgetExhausted('El presupuesto se agotó durante la espera de reintento.', {
        cause: error,
      });
    }
  }

  private assertNotAborted(budget?: AbortSignal): void {
    if (budget?.aborted === true) {
      throw this.errors.budgetExhausted('El presupuesto se agotó antes de la llamada.');
    }
  }
}

/**
 * Reconoce «no queda saldo» en las tres formas en que llega: el estado que
 * OpenRouter reserva para ello, un código de facturación, o la prosa del
 * proveedor físico cuando el gateway aplanó su error estructurado.
 */
function saysCreditsExhausted(error: HttpProviderError): boolean {
  if (error.quotaExhausted) return true;
  if (error.status === PAYMENT_REQUIRED_STATUS) return true;
  return error.code !== undefined && CREDITS_EXHAUSTED_CODES.has(error.code);
}

function retryAfterMsOf(error: unknown): number | undefined {
  return error instanceof HttpProviderError ? error.retryAfterMs : undefined;
}

/**
 * Reconoce un plazo vencido, esté donde esté en la cadena de causas.
 *
 * `fetch` NO propaga el `TimeoutError` tal cual: `undici` lo envuelve en un
 * `TypeError: fetch failed` y lo deja en `cause`. Mirando sólo el error de
 * arriba, un gateway que deja de contestar se reportaba como «no fue posible
 * completar la clasificación semántica» —el cajón de los fallos de red—, y el
 * desenlace era el correcto por casualidad: los dos son reintentables. Lo que se
 * perdía era la única pista que distingue «el gateway está caído» de «el gateway
 * tarda más de lo que le damos», que son dos incidentes distintos y se arreglan
 * de formas opuestas: uno se levanta, el otro se le sube el plazo.
 */
function isTimeout(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) return false;
    // Se mira `name` por forma y no con `instanceof Error`: quien aborta un
    // `fetch` es un `DOMException` creado por el realm de Node, y una prueba de
    // Jest —que corre en su propio contexto de VM— tiene otro `Error` global,
    // así que `instanceof` es falso ahí aunque el objeto sea exactamente el que
    // llega en producción. Comprobar la forma vale en los dos sitios.
    const { name, cause } = current as { name?: unknown; cause?: unknown };
    if (name === 'TimeoutError' || name === 'AbortError') return true;
    current = cause;
  }
  return false;
}
