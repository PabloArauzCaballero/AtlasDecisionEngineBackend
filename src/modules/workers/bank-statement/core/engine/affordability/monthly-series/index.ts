/**
 * El extracto convertido en meses naturales, que es la única unidad en la que
 * un ingreso y una cuota significan algo.
 *
 * ## Por qué meses naturales y no ventanas de treinta días
 *
 * Porque los hechos que se miden están anclados al calendario: el sueldo cae el
 * último día hábil, las cuotas se cobran el 5 o el 15, los servicios básicos
 * vencen a fin de mes. Una ventana móvil de treinta días parte esos pares —deja
 * dos sueldos en una ventana y ninguno en la siguiente— y produce una serie que
 * oscila por un artefacto del corte, no por la vida de la persona.
 *
 * ## Por qué la COMPLETITUD del mes se mide y se publica
 *
 * Un extracto que va del 12 de marzo al 20 de junio toca cuatro meses y sólo
 * cubre dos enteros. Contar los cuatro sería inflar la cobertura justo donde más
 * daño hace: los meses de los bordes tienen la mitad de los movimientos, así que
 * bajan la mediana del ingreso y del gasto a la vez, y el disponible que sale de
 * ahí no describe ningún mes que la persona haya vivido.
 */
export { buildMonthlySeries } from './build-series';
export { classifyMovements, streamLabel } from './classify-movements';
export { assessCoverage, observationWindow } from './coverage';
export type {
  AffordabilityTransaction,
  ClassifiedMovement,
  MovementClassificationContext,
} from './types';
