/**
 * El glosario que publica el EMISOR, contra el léxico que escribimos nosotros.
 *
 * ## Qué cambia esto
 *
 * `movement-lexicon.ts` adivina qué es un movimiento a partir de palabras
 * («sueldo», «préstamo», «seguro»). Funciona, y tiene un techo: las glosas
 * reales de un banco boliviano no son palabras, son códigos. `CENT_PAGO_PREST`,
 * `NCRSIREJRET`, `WASIREJSUSODSCICC-`, `BL`, `CTPV`, `ODG`. Ninguna regla
 * escrita de memoria las acierta, y cada una de ellas mueve dinero de sitio en
 * el cálculo de capacidad de pago.
 *
 * El corpus trae las **147 filas del glosario oficial del BCP**, que es el único
 * emisor boliviano con glosario publicado que la investigación encontró. Esto
 * las consulta.
 *
 * ## Las cuatro reglas que gobiernan este archivo
 *
 * 1. **La columna contable manda sobre la dirección declarada.** El glosario
 *    dice que `ACH REC` puede ser cargo o abono y que los `NCR…` son cargos;
 *    cuando la fila dice otra cosa, gana la fila. Forzar el lado por la glosa es
 *    una de las reglas de importación que el corpus prohíbe expresamente, y su
 *    contradicción C10 existe justo por esto. Lo que sí se hace es DECLARAR la
 *    discrepancia, que es información para quien revisa.
 * 2. **La categoría es analítica, no del banco.** El corpus la marca `INFERIDO`
 *    en las 147: el emisor publica el literal y su significado en prosa, no una
 *    taxonomía. Por eso la consulta devuelve `categoryIsInferred: true` y por
 *    eso no se puede presentar como «el banco dice que esto es un seguro».
 * 3. **No se inventan expresiones regulares.** Las 147 traen `regex: null` y
 *    `match_requires_local_calibration: true`. Lo único que se deriva es lo que
 *    el propio literal declara: `AAAAMMDD` es una fecha, `"Empresa"` es un
 *    hueco, `+NÚMERO DE OPERACIÓN` es un sufijo. Nada más.
 * 4. **No se finge el glosario de nadie más.** El corpus encontró UN glosario
 *    oficial. Para los otros 66 emisores esto devuelve vacío y el léxico
 *    heurístico sigue siendo lo que hay. Rellenar los huecos con las glosas del
 *    BCP sería la peor clase de error: parecería cobertura.
 *
 * ## El peligro de los literales de una y dos letras
 *
 * El glosario tiene entradas como `I` (banca por internet), `M` (móvil), `AP`
 * (transferencia al exterior), `BA` (agente), `BL` (SOLI) y `CW` (Credinet).
 * Casarlas por prefijo convertiría cualquier glosa que empiece por «I » en una
 * operación de internet. Por eso un literal de menos de tres caracteres **sólo
 * casa exacto**, y eso deja fuera casos legítimos a propósito: preferimos no
 * clasificar a clasificar mal, porque lo segundo mueve dinero en silencio.
 */
export { hasOfficialGlossary, normalizeOfficialGloss } from './index-build';
export { directionCoherence, lookupOfficialGlossary } from './lookup';
export type { DirectionCoherence } from './lookup';
export type { GlossaryLookup, GlossaryMatch, GlossaryMatchKind } from './types';
