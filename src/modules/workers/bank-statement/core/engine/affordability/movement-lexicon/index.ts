/**
 * Qué ES cada movimiento del extracto, decidido por su glosa.
 *
 * ## Por qué un léxico y no el clasificador semántico
 *
 * El motor ya tiene un worker semántico que clasifica glosas con un árbol de
 * categorías curado y un modelo detrás. Es mejor que esto en precisión y no
 * sirve aquí: la capacidad de pago se calcula DENTRO de la conversión del
 * extracto, en el camino caliente y sin salir a ningún servicio, y un extracto
 * de tres meses trae entre cien y quinientos movimientos. Pagar una inferencia
 * por cada uno convertiría una conversión de dos segundos en una de dos minutos,
 * y ataría el cálculo de capacidad de pago a la disponibilidad de un modelo.
 *
 * El reparto es: este léxico decide DÓNDE cae cada boliviano —que es lo que
 * mueve el número— y el worker semántico, cuando alguien lo pide, explica cada
 * glosa una a una. Son dos preguntas distintas con dos costes distintos.
 *
 * ## Por qué la clasificación de un gasto importa tanto como su importe
 *
 * Porque el disponible no es «ingreso menos gasto». Un extracto donde la persona
 * gastó todo lo que entró no significa que no pueda pagar una cuota: significa
 * que su gasto se ajustó a su ingreso, y buena parte de ese gasto es
 * comprimible. Lo que NO es comprimible —la cuota del préstamo, el seguro, la
 * luz, el alquiler— es lo que hay que restar de verdad. Meter la cena del sábado
 * en el mismo saco que la cuota del banco produce el error clásico de la banca
 * por datos: rechazar a quien gasta mucho y podría pagar, y aprobar a quien
 * gasta poco porque ya no le queda nada después de sus cuotas.
 *
 * ## Sobre el vocabulario
 *
 * Es boliviano y es de extractos reales: las glosas de BNB, Mercantil Santa
 * Cruz, BCP, Unión, Ganadero, Económico y BancoSol, más las del sistema
 * interbancario (ACH, LIP) y las de las billeteras móviles. Se compara sin
 * acentos y en minúsculas porque el mismo banco alterna «devolución» y
 * «devolucion» según el canal por el que genere el PDF.
 */
export { classifyInflow, classifyOutflow, normalizeGloss } from './classify';
export { COMMITTED_OUTFLOWS, RECOGNIZED_INFLOWS, THIRD_PARTY_OBLIGATIONS } from './kind-sets';
export { isCollectionAction, isNsf, officialCategoryToKind } from './official-category';
export type { InflowKind, OutflowKind } from './types';
