import { LlmBudgetExhaustedError, LlmProviderError } from '../llm-provider.error';

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
