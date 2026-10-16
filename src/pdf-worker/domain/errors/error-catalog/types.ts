/**
 * Catálogo de TODOS los errores que este worker puede devolver.
 *
 * No es documentación: es un dato del programa, se publica en `GET /pdf/errors` y una prueba
 * (`test/pdf-error-catalog.spec.ts`) comprueba tres cosas que juntas impiden que envejezca —
 * que todo código tenga entrada, que toda entrada corresponda a un código, y que el
 * `httpStatus` de cada clase de error coincida con el que aquí se publica.
 *
 * Sin esa prueba, un error nuevo llega al cliente sin explicación y una entrada vieja sigue
 * prometiendo un comportamiento que ya no existe. Las dos cosas se descubren tarde y desde
 * fuera.
 *
 * `audience` es el campo que más ahorra en una incidencia: distingue lo que arregla quien
 * llama —su payload, su versión de template— de lo que sólo puede arreglar quien opera el
 * despliegue. `retryable` dice si insistir sirve de algo; reintentar un 422 es tiempo perdido
 * y reintentar un 429 es exactamente lo que hay que hacer.
 */
import { type PdfErrorCode } from '../pdf-worker.errors';

export type ErrorAudience = 'consumidor' | 'operador' | 'ambos';

export interface ErrorCatalogEntry {
  readonly code: PdfErrorCode;
  readonly httpStatus: number;
  readonly title: string;
  /** Qué significa, en una frase. */
  readonly meaning: string;
  /** Por qué suele ocurrir. */
  readonly cause: string;
  /** Qué hacer para resolverlo. */
  readonly remedy: string;
  /** ¿Reintentar la MISMA petición puede tener éxito? */
  readonly retryable: boolean;
  readonly audience: ErrorAudience;
}
