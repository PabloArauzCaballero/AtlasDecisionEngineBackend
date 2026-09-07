import { setTimeout as delay } from 'node:timers/promises';
import { LlmBudgetExhaustedError, LlmProviderError } from './llm-provider.error';

/**
 * Reintentos, plazos y clasificación de fallos para los adaptadores que hablan
 * la interfaz de OpenAI.
 *
 * Vive fuera de cada adaptador por el mismo motivo que `classification-contract`:
 * son VARIOS proveedores contra la misma superficie HTTP, y lo que aquí se
 * decide —qué se reintenta, cuánto se espera, qué error se le presenta a quien
 * llamó— es exactamente lo que no debe divergir entre ellos. Si el adaptador de
 * OpenAI reintentara un 429 y el de LiteLLM no, dos despliegues del mismo motor
 * llenarían la bandeja de revisión a ritmos distintos sin que nada en el
 * catálogo ni en el texto lo explicara.
 *
 * **Y vive en `common` porque ya no lo usa un solo módulo.** Desde que el
 * árbitro de identidad llama a OpenRouter, la clasificación de «saldo agotado»
 * —que es la parte cara de acertar, y la que se midió contra cuentas reales sin
 * fondos— la necesitan dos workers. Dejarla dentro del semántico habría obligado
 * a identidad a importar el dominio ajeno; copiarla habría creado dos listas de
 * firmas que se separan al primer proveedor nuevo.
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
export const CREDITS_EXHAUSTED_CODES: ReadonlySet<string> = new Set([
  'insufficient_quota',
  'insufficient_credits',
  'billing_hard_limit_reached',
  'budget_exceeded',
]);

/**
 * El estado con el que OpenRouter dice «no te quedan créditos». Es permanente
 * por sí solo: ningún reintento crea saldo.
 */
export const PAYMENT_REQUIRED_STATUS = 402;

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
  // OpenRouter: la cuenta se quedó sin créditos. Viaja como 402, que ya no se
  // reintenta por estado; se lista igual por si algún día llega con otro.
  'insufficient_credits',
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
 * Frases con las que un proveedor dice «no te queda saldo», tal como sobreviven al gateway.
 *
 * Mirar la PROSA es lo último que uno quiere hacer, y aquí es lo único que queda. Verificado
 * contra un LiteLLM real con una cuenta de OpenAI sin fondos: el gateway aplana el error
 * estructurado del proveedor y lo que llega es
 *
 *     { "error": { "code": "429", "type": null,
 *                  "message": "litellm.RateLimitError: ... OpenAIException -
 *                              You exceeded your current quota, ..." } }
 *
 * Ni rastro de `insufficient_quota`: el código es el propio estado HTTP y el tipo viene vacío.
 * Sin esta comprobación, una cuenta sin saldo consume los tres intentos y su retroceso **en cada
 * glosa y para siempre**, que es exactamente el fallo que `PERMANENT_ERROR_CODES` existe para
 * impedir y que las pruebas con dobles no veían, porque imitaban la forma NATIVA de OpenAI y no
 * la que produce el gateway.
 *
 * La lista se mantiene corta y sin ambigüedad a propósito: un límite de tasa de verdad SÍ debe
 * reintentarse, así que sólo se degrada a permanente lo que no puede ser otra cosa.
 */
const QUOTA_EXHAUSTED_SIGNATURES: readonly string[] = [
  'exceeded your current quota',
  'insufficient_quota',
  'insufficient quota',
  'credit balance is too low',
  'billing hard limit',
  'exceeded your monthly',
  // OpenRouter, literal: «Insufficient credits. Add more using https://openrouter.ai/…».
  'insufficient credits',
];

/**
 * Error interno para transportar el código HTTP, su `Retry-After` y el código de
 * error del proveedor hasta la clasificación.
 */
export class HttpProviderError extends Error {
  public constructor(
    public readonly status: number,
    public readonly retryAfterMs: number | undefined,
    public readonly code: string | undefined,
    /** El cuerpo delata saldo agotado, aunque el estado diga «vuelve a intentarlo». */
    public readonly quotaExhausted: boolean = false,
  ) {
    super(code === undefined ? `HTTP ${status}` : `HTTP ${status} (${code})`);
    this.name = 'HttpProviderError';
  }
}

/**
 * Fábrica de los errores que el transporte le entrega a quien llamó.
 *
 * El transporte sabe QUÉ pasó —permanente o pasajero, del proveedor o del
 * reloj— y no debe saber cómo lo nombra cada módulo. El semántico distingue
 * `SemanticTimeoutError` para rescatar un análisis a medias; identidad no
 * distingue nada y se queda con las clases genéricas. Inyectarlo mantiene esa
 * diferencia donde pertenece, en cada módulo, sin duplicar la clasificación.
 */
export interface TransportErrors {
  /** Fallo atribuible al proveedor. `retryable` decide si habrá otro intento. */
  provider(message: string, retryable: boolean, options?: ErrorOptions): Error;
  /** El presupuesto de tiempo de quien llamó se agotó. Nunca se reintenta. */
  budgetExhausted(message: string, options?: ErrorOptions): Error;
  /**
   * Reconoce un error que el propio intento ya clasificó, para devolverlo tal
   * cual en vez de envolverlo otra vez y perder su mensaje. Devuelve si es
   * reintentable, o `undefined` si el error no es suyo.
   */
  classified(error: unknown): { readonly retryable: boolean } | undefined;
  /**
   * Se acabó el saldo de la cuenta del proveedor.
   *
   * Es opcional porque no todos los módulos necesitan distinguirlo: al worker
   * semántico le basta con que sea permanente y no gaste reintentos. Al árbitro
   * de identidad NO le basta —un despliegue sin créditos y un despliegue con el
   * modelo caído se arreglan de formas distintas, y desde la bandeja los dos se
   * ven igual—, así que lo distingue. Sin este miembro, cae en `provider` como
   * cualquier otro fallo permanente y nada cambia.
   */
  quotaExhausted?(message: string, options?: ErrorOptions): Error;
}

/** Las clases genéricas de `common`, para quien no tenga taxonomía propia. */
export const DEFAULT_TRANSPORT_ERRORS: TransportErrors = {
  provider: (message, retryable, options) => new LlmProviderError(message, retryable, options),
  budgetExhausted: (message, options) => new LlmBudgetExhaustedError(message, options),
  classified: (error) =>
    error instanceof LlmProviderError ? { retryable: error.retryable } : undefined,
};

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
      throw this.errors.budgetExhausted(
        'El presupuesto se agotó durante la espera de reintento.',
        { cause: error },
      );
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

/**
 * Extrae `error.code` (o `error.type`) del cuerpo de un error.
 *
 * Nunca propaga un fallo propio: un cuerpo vacío, truncado o que no sea JSON
 * deja el código sin determinar, y la clasificación cae de vuelta en el estado
 * HTTP. Perder el código degrada la precisión; hacer fallar la lectura perdería
 * además el error real del proveedor.
 */
export interface ProviderErrorDetail {
  /** Identificador del error, si el proveedor publicó uno utilizable. */
  readonly code: string | undefined;
  /** El cuerpo dice que se acabó el saldo, con independencia del estado HTTP. */
  readonly quotaExhausted: boolean;
}

export async function readErrorDetail(response: Response): Promise<ProviderErrorDetail> {
  const nothing: ProviderErrorDetail = { code: undefined, quotaExhausted: false };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return nothing;
  }
  if (typeof body !== 'object' || body === null) {
    return nothing;
  }
  const error: unknown = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) {
    return nothing;
  }
  const { code, type, message } = error as { code?: unknown; type?: unknown; message?: unknown };
  const candidate = typeof code === 'string' ? code : type;
  return {
    code: typeof candidate === 'string' && ERROR_CODE_SHAPE.test(candidate) ? candidate : undefined,
    quotaExhausted: saysQuotaExhausted(message),
  };
}

/**
 * Reconoce el saldo agotado en el texto del proveedor.
 *
 * Se compara en minúsculas y por subcadena porque el gateway antepone su propia envoltura
 * (`litellm.RateLimitError: RateLimitError: OpenAIException - …`) al mensaje original.
 */
function saysQuotaExhausted(message: unknown): boolean {
  if (typeof message !== 'string') return false;
  const normalized = message.toLowerCase();
  return QUOTA_EXHAUSTED_SIGNATURES.some((signature) => normalized.includes(signature));
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
export function parseStructuredOutput(
  outputText: string,
  errors: TransportErrors = DEFAULT_TRANSPORT_ERRORS,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (error: unknown) {
    throw errors.provider('La salida estructurada no es JSON válido.', false, { cause: error });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw errors.provider('La salida estructurada no es un objeto JSON.', false);
  }
  return parsed as Record<string, unknown>;
}

/** Normaliza una base de API quitando las barras finales. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/u, '');
}

/**
 * El texto de `message.content`, admitiendo las dos formas que atraviesan un
 * gateway.
 *
 * Los proxies normalizan a cadena para casi todos sus proveedores, pero los que
 * devuelven bloques de contenido (Anthropic, Vertex) pueden atravesarlos como
 * lista. Rechazar la lista dejaría el mismo modelo funcionando con un proveedor
 * y roto con su suplente, que es exactamente el fallo que un gateway existe
 * para evitar y el que sólo se manifiesta durante una caída. Vive aquí y no en
 * cada adaptador porque LiteLLM y OpenRouter comparten el problema letra por
 * letra.
 */
export function extractMessageContent(
  content: unknown,
  errors: TransportErrors = DEFAULT_TRANSPORT_ERRORS,
): string {
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
  throw errors.provider('La respuesta del modelo no contiene salida estructurada.', false);
}

function isTextPart(part: unknown): part is { text: string } {
  return (
    typeof part === 'object' &&
    part !== null &&
    typeof (part as { text?: unknown }).text === 'string'
  );
}
