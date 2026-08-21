import { setTimeout as delay } from 'node:timers/promises';
import { SemanticProviderError, SemanticTimeoutError } from '../../domain/semantic-analysis.errors';

/**
 * Reintentos, plazos y clasificación de fallos para los adaptadores que hablan
 * la interfaz de OpenAI.
 *
 * Vive fuera de cada adaptador por el mismo motivo que `classification-contract`:
 * son DOS proveedores contra la misma superficie HTTP, y lo que aquí se decide
 * —qué se reintenta, cuánto se espera, qué error se le presenta al pipeline— es
 * exactamente lo que no debe divergir entre ellos. Si el adaptador de OpenAI
 * reintentara un 429 y el de LiteLLM no, dos despliegues del mismo motor
 * llenarían la bandeja de revisión a ritmos distintos sin que nada en el
 * catálogo ni en el texto lo explicara.
 *
 * Lo que NO vive aquí es lo específico de cada API: la forma del cuerpo, dónde
 * está la salida estructurada y cómo se llama el modelo que respondió. Eso lo
 * pone cada adaptador en su llamada a `send`.
 */

/** Estados que describen una condición pasajera y merecen otro intento. */
export const RETRYABLE_STATUS_CODES: ReadonlySet<number> = new Set([
  408, 409, 425, 429, 500, 502, 503, 504,
]);

/**
 * Códigos que llegan con un estado formalmente reintentable pero describen una
 * condición permanente de la cuenta. `insufficient_quota` viaja como 429 igual
 * que un límite de tasa: sin mirar el código, agotar el saldo consume los tres
 * intentos y su retroceso antes de fallar, y lo reporta como transitorio.
 */
export const PERMANENT_ERROR_CODES: ReadonlySet<string> = new Set([
  'insufficient_quota',
  'billing_hard_limit_reached',
  'billing_not_active',
  'account_deactivated',
  // Propios del gateway: el alias lógico no existe en su `model_list`, o ningún
  // despliegue detrás de él tiene credencial. Insistir no lo va a crear.
  'model_not_found',
  'invalid_model',
  'budget_exceeded',
]);

/**
 * Forma admitida para un código de error del proveedor. Acota lo que puede
 * llegar al mensaje y a los registros: el cuerpo del error es texto controlado
 * por un tercero, y sólo el identificador —no la prosa que lo acompaña— tiene
 * valor para clasificar.
 */
const ERROR_CODE_SHAPE = /^[A-Za-z0-9_.-]{1,64}$/u;

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_INITIAL_BACKOFF_MS = 500;
export const DEFAULT_MAX_BACKOFF_MS = 8_000;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 2_048;

/**
 * Error interno para transportar el código HTTP, su `Retry-After` y el código de
 * error del proveedor hasta la clasificación.
 */
export class HttpProviderError extends Error {
  public constructor(
    public readonly status: number,
    public readonly retryAfterMs: number | undefined,
    public readonly code: string | undefined,
  ) {
    super(code === undefined ? `HTTP ${status}` : `HTTP ${status} (${code})`);
    this.name = 'HttpProviderError';
  }
}

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

  public constructor(options: TransportOptions) {
    this.providerLabel = options.providerLabel;
    this.requestTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.randomSource = options.randomSource ?? Math.random;
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
    let lastError: SemanticProviderError | undefined;

    for (let attemptNumber = 1; attemptNumber <= this.maxAttempts; attemptNumber += 1) {
      this.assertNotAborted(budget);
      try {
        return await attempt(this.signalFor(budget));
      } catch (error: unknown) {
        const providerError = this.toProviderError(error, budget);
        if (!providerError.retryable || attemptNumber === this.maxAttempts) {
          throw providerError;
        }
        lastError = providerError;
        await this.waitBeforeRetry(attemptNumber, retryAfterMsOf(error), budget);
      }
    }

    throw (
      lastError ?? new SemanticProviderError('No fue posible completar la clasificación.', true)
    );
  }

  private signalFor(budget?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.requestTimeoutMs);
    return budget === undefined ? timeout : AbortSignal.any([budget, timeout]);
  }

  /**
   * Clasifica cualquier fallo en reintentable o permanente sin filtrar el
   * contenido analizado.
   */
  private toProviderError(error: unknown, budget?: AbortSignal): SemanticProviderError {
    if (error instanceof SemanticProviderError) {
      return error;
    }
    if (error instanceof HttpProviderError) {
      const retryable =
        RETRYABLE_STATUS_CODES.has(error.status) &&
        !(error.code !== undefined && PERMANENT_ERROR_CODES.has(error.code));
      const detail = error.code === undefined ? '' : ` (${error.code})`;
      return new SemanticProviderError(
        `${this.providerLabel} respondió con HTTP ${String(error.status)}${detail}.`,
        retryable,
      );
    }
    if (budget?.aborted === true) {
      return new SemanticProviderError(
        'El análisis fue abortado por presupuesto de tiempo.',
        false,
        { cause: error },
      );
    }
    if (isTimeout(error)) {
      return new SemanticProviderError(
        `La llamada al proveedor superó ${String(this.requestTimeoutMs)} ms.`,
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
    budget?: AbortSignal,
  ): Promise<void> {
    const exponential = Math.min(this.initialBackoffMs * 2 ** (attempt - 1), this.maxBackoffMs);
    const jittered = Math.round(exponential * (0.5 + this.randomSource() * 0.5));
    const waitMs = Math.min(Math.max(retryAfterMs ?? jittered, 0), this.maxBackoffMs);
    try {
      await delay(waitMs, undefined, { signal: budget });
    } catch (error: unknown) {
      throw new SemanticTimeoutError('El presupuesto se agotó durante la espera de reintento.', {
        cause: error,
      });
    }
  }

  private assertNotAborted(budget?: AbortSignal): void {
    if (budget?.aborted === true) {
      throw new SemanticTimeoutError('El presupuesto de análisis se agotó antes de la llamada.');
    }
  }
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

/**
 * Extrae `error.code` (o `error.type`) del cuerpo de un error.
 *
 * Nunca propaga un fallo propio: un cuerpo vacío, truncado o que no sea JSON
 * deja el código sin determinar, y la clasificación cae de vuelta en el estado
 * HTTP. Perder el código degrada la precisión; hacer fallar la lectura perdería
 * además el error real del proveedor.
 */
export async function readErrorCode(response: Response): Promise<string | undefined> {
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
  return typeof candidate === 'string' && ERROR_CODE_SHAPE.test(candidate) ? candidate : undefined;
}

export function readRetryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (header === null) {
    return undefined;
  }
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined;
}

/**
 * Convierte el cuerpo de una respuesta en el objeto JSON que se espera de la
 * salida estructurada, con errores que distinguen «no es JSON» de «no es un
 * objeto».
 */
export function parseStructuredOutput(outputText: string): Record<string, unknown> {
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

/** Normaliza una base de API quitando las barras finales. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/u, '');
}
