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
export {
  CREDITS_EXHAUSTED_CODES,
  PAYMENT_REQUIRED_STATUS,
  PERMANENT_ERROR_CODES,
  RETRYABLE_STATUS_CODES,
} from './error-signatures';
export {
  DEFAULT_INITIAL_BACKOFF_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_BACKOFF_MS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_TIMEOUT_MS,
} from './defaults';
export {
  HttpProviderError,
  DEFAULT_TRANSPORT_ERRORS,
  type TransportErrors,
} from './provider-errors';
export { readErrorDetail, readRetryAfterMs, type ProviderErrorDetail } from './error-detail';
export { OpenAiCompatibleTransport, type TransportOptions } from './transport';
export {
  extractMessageContent,
  normalizeBaseUrl,
  parseStructuredOutput,
} from './structured-output';
