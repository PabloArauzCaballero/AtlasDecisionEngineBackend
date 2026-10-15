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
export const ERROR_CODE_SHAPE = /^[A-Za-z0-9_.-]{1,64}$/u;

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
 * Reconoce el saldo agotado en el texto del proveedor.
 *
 * Se compara en minúsculas y por subcadena porque el gateway antepone su propia envoltura
 * (`litellm.RateLimitError: RateLimitError: OpenAIException - …`) al mensaje original.
 */
export function saysQuotaExhausted(message: unknown): boolean {
  if (typeof message !== 'string') return false;
  const normalized = message.toLowerCase();
  return QUOTA_EXHAUSTED_SIGNATURES.some((signature) => normalized.includes(signature));
}
