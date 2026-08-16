/**
 * POR QUÉ una glosa acabó en la bandeja de revisión.
 *
 * **`REVIEW_REQUIRED` a secas no sirve.** Una bandeja donde todo llegó «porque
 * sí» no se puede triar —no hay forma de atender antes lo ambiguo que lo que
 * simplemente tardó—, no se puede medir —¿estamos mejorando el clasificador o
 * sólo tapando un proveedor lento?— y no se puede auditar: dentro de un mes
 * nadie sabrá si aquel término se escaló porque el motor dudaba o porque ese día
 * el modelo no respondía.
 *
 * **Es vocabulario cerrado a propósito.** El motivo se guarda dentro del
 * `context` del pendiente, que es JSON libre; sin una lista cerrada acabarían
 * conviviendo `timeout`, `TIMEOUT` y `tiempo agotado` y ningún filtro los
 * juntaría.
 */

export const MOTIVOS_DE_REVISION = {
  /** El motor respondió, pero ninguna candidata alcanzó su umbral. */
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  /** El análisis no terminó dentro del plazo. NO es un fallo: es lentitud. */
  TIMEOUT: 'TIMEOUT',
  /** Falló de forma transitoria por algo que no es el reloj (red, proveedor). */
  PROCESSING_ERROR: 'PROCESSING_ERROR',
} as const;

export type MotivoDeRevision = (typeof MOTIVOS_DE_REVISION)[keyof typeof MOTIVOS_DE_REVISION];

/**
 * Códigos de error que significan «tardó», no «está roto».
 *
 * Es la distinción que sostiene todo lo demás. Una glosa que agota el reloj
 * puede ser perfectamente clasificable —un caso complejo, un proveedor externo
 * lento, una cola cargada— y marcarla como fallida afirma algo que no se sabe.
 * Peor aún: la sacaba del circuito, porque lo fallido no se revisa, se reintenta.
 */
const CODIGOS_DE_LATENCIA: ReadonlySet<string> = new Set(['SEMANTIC_TIMEOUT']);

/**
 * El motivo con el que un análisis fallido debe escalarse, o `null` si ese fallo
 * NO debe ir a revisión.
 *
 * Sólo se escala lo que un humano podría resolver mirando la glosa. Un error de
 * configuración del motor —una credencial ausente, un modelo mal declarado— no
 * lo arregla nadie desde una bandeja de clasificación: mandarlo ahí llenaría la
 * cola de trabajo con avisos que ninguno de sus destinatarios puede atender, y
 * escondería el fallo real detrás de cientos de pendientes.
 */
export function motivoDeRevisionPara(
  errorCode: string,
  esReintentable: boolean,
): MotivoDeRevision | null {
  if (CODIGOS_DE_LATENCIA.has(errorCode)) return MOTIVOS_DE_REVISION.TIMEOUT;
  return esReintentable ? MOTIVOS_DE_REVISION.PROCESSING_ERROR : null;
}
