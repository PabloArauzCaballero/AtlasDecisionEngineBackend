/**
 * Lo que la imagen delata sobre sí misma, mirando los píxeles y no el texto.
 *
 * ## El ataque que el resto del worker no ve
 *
 * Todo lo demás —el catálogo, el clasificador semántico, el analizador de
 * campos— trabaja sobre el TEXTO leído. Contra eso, el fraude más barato que
 * existe no compite: consiste en no tener la tarjeta. Se descarga una foto de
 * una cédula ajena, se abre en la pantalla del portátil y se fotografía con el
 * móvil; o se coge una cédula real y se le pega encima otro retrato. En los dos
 * casos el texto es impecable, porque el texto es el de un documento auténtico.
 *
 * Lo que cambia son los píxeles, y de formas que se pueden medir:
 *
 * - **La rejilla de la pantalla.** Un panel LCD tiene subpíxeles en cuadrícula
 *   regular. Fotografiarlo produce una periodicidad de período corto que ninguna
 *   superficie impresa tiene. Es la señal más específica de todas: una tarjeta
 *   de plástico no puede producirla.
 * - **La huella de la recompresión.** Un JPEG guardado dos veces conserva rastro
 *   de la primera cuantización. Si además una REGIÓN se pegó desde otra imagen,
 *   esa región llega con un historial de compresión distinto del resto y su
 *   residuo al recomprimir se separa del de sus vecinos.
 * - **El ruido que no es continuo.** El sensor de una cámara deja un grano
 *   parecido en toda la escena. Un recorte pegado trae el grano de OTRA cámara,
 *   o ninguno si se generó por software.
 * - **El marco.** Una foto de una pantalla casi siempre lleva alrededor el borde
 *   negro del dispositivo o del visor.
 *
 * ## Ninguna de estas señales rechaza a nadie por su cuenta
 *
 * Y es deliberado. Todas tienen falsos positivos honestos: una cédula plastificada
 * bajo un fluorescente produce muaré, una foto muy comprimida por la app de
 * mensajería produce residuos raros, un fondo liso produce ruido no uniforme. Lo
 * que hacen es SUMAR al puntaje de fraude, y quien decide es
 * `identity-fraud.scorer.ts`. Acusar de falsificación con una heurística de
 * píxeles a solas sería la peor decisión posible de este módulo.
 *
 * Todo es best-effort: si `sharp` no puede con la imagen, esto devuelve
 * `disponible: false` y el fusor lo trata como una prueba que falta, no como una
 * prueba superada.
 */
export { analizarManipulacion } from './analyze';
export type { AnalisisDeManipulacion, SenalDeManipulacion } from './types';
