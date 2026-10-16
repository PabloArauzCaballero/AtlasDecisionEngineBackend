import type { MonthlyBucket } from '../affordability-model';
import {
  COMMITTED_OUTFLOWS,
  THIRD_PARTY_OBLIGATIONS,
  RECOGNIZED_INFLOWS,
} from '../movement-lexicon';
import { round2 } from '../statistics';
import { monthsBetween } from './coverage';
import { ClassifiedMovement, MILLISECONDS_PER_DAY } from './types';

/**
 * Agrupa por mes natural y calcula lo que cada mes aporta.
 *
 * @param recognizedLabels Etiquetas de abonos que la detección de recurrencia
 * rescató: entran como ingreso aunque su glosa no los identifique. Se pasa desde
 * fuera porque la recurrencia se calcula sobre TODOS los meses a la vez y este
 * agrupado es por mes — resolverlo aquí obligaría a recorrer dos veces con
 * criterios distintos, que es como se llega a que los totales no cuadren.
 */
export function buildMonthlySeries(
  movements: readonly ClassifiedMovement[],
  window: { from: Date; to: Date },
  recognizedLabels: ReadonlySet<string> = new Set(),
): MonthlyBucket[] {
  const byMonth = new Map<string, ClassifiedMovement[]>();
  for (const movement of movements) {
    const bucket = byMonth.get(movement.month);
    if (bucket) bucket.push(movement);
    else byMonth.set(movement.month, [movement]);
  }

  /*
   * Un mes CUBIERTO y sin movimientos también es un mes.
   *
   * Antes no existía: los meses salían de agrupar movimientos, así que un mes
   * entero sin actividad desaparecía de la serie y no entraba en ninguna
   * mediana. El efecto es el que más importa de todo este archivo: **inflaba el
   * ingreso**. Una persona con 5.000 en enero, nada en febrero y 5.000 en marzo
   * declaraba una mediana de 5.000 cuando su ingreso mensual observado es 3.333.
   *
   * El corpus lo fija como regla, y distingue las dos cosas que aquí se
   * confundían: un mes cubierto sin ingreso vale CERO, y un mes no cubierto vale
   * NULL. Lo primero es una observación; lo segundo es la falta de una. Por eso
   * el hueco se materializa sólo dentro de la ventana observada, y llega marcado
   * con `hasActivity: false` para que quien mire sepa qué clase de cero es.
   */
  for (const month of monthsBetween(window.from, window.to)) {
    if (!byMonth.has(month)) byMonth.set(month, []);
  }

  return [...byMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, items]) => toBucket(month, items, window, recognizedLabels));
}

function toBucket(
  month: string,
  items: readonly ClassifiedMovement[],
  window: { from: Date; to: Date },
  recognizedLabels: ReadonlySet<string>,
): MonthlyBucket {
  let inflowTotal = 0;
  let outflowTotal = 0;
  let recognizedIncome = 0;
  let thirdPartyObligations = 0;
  let committedSpend = 0;
  let discretionarySpend = 0;
  let nsfEvents = 0;
  let minBalance: number | null = null;
  let closingBalance: number | null = null;

  for (const item of items) {
    if (item.nsf) nsfEvents += 1;

    if (item.direction === 'INFLOW') {
      inflowTotal += item.amount;
      const recognizedByGloss = RECOGNIZED_INFLOWS.has(item.kind as never);
      /*
       * El rescate por cadencia NO alcanza a lo que el emisor excluyó.
       *
       * `EXCLUDE_FROM_RECURRING_INCOME` lo dice en el nombre, y las 28 glosas
       * que lo llevan son justo las que más se repiten con importe parecido:
       * regularizaciones mensuales, devoluciones de comisión, liberaciones
       * judiciales, compraventa de moneda. Son exactamente el perfil que la
       * detección de recurrencia confunde con un sueldo.
       */
      const excludedByIssuer = item.officialIncomeTreatment === 'EXCLUDE_FROM_RECURRING_INCOME';
      const recognizedByCadence =
        item.kind === 'ONE_OFF' && !excludedByIssuer && recognizedLabels.has(item.label);
      if (recognizedByGloss || recognizedByCadence) recognizedIncome += item.amount;
    } else {
      outflowTotal += item.amount;
      if (THIRD_PARTY_OBLIGATIONS.has(item.kind as never)) thirdPartyObligations += item.amount;
      if (COMMITTED_OUTFLOWS.has(item.kind as never)) committedSpend += item.amount;
      else discretionarySpend += item.amount;
    }

    if (item.balance !== null && Number.isFinite(item.balance)) {
      minBalance = minBalance === null ? item.balance : Math.min(minBalance, item.balance);
      // El último apunte del mes trae el saldo con el que se cierra. Los
      // movimientos llegan en el orden del documento, que es el de lectura.
      closingBalance = item.balance;
    }
  }

  const monthStart = new Date(`${month}-01T00:00:00Z`);
  const monthEnd = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0, 23, 59, 59),
  );
  const coveredFrom = window.from > monthStart ? window.from : monthStart;
  const coveredTo = window.to < monthEnd ? window.to : monthEnd;
  const daysInMonth = monthEnd.getUTCDate();
  const daysCovered = Math.max(
    0,
    Math.round((coveredTo.getTime() - coveredFrom.getTime()) / MILLISECONDS_PER_DAY) + 1,
  );

  return {
    month,
    transactionCount: items.length,
    hasActivity: items.length > 0,
    inflowTotal: round2(inflowTotal),
    outflowTotal: round2(outflowTotal),
    recognizedIncome: round2(recognizedIncome),
    thirdPartyObligations: round2(thirdPartyObligations),
    committedSpend: round2(committedSpend),
    discretionarySpend: round2(discretionarySpend),
    nsfEvents,
    closingBalance: closingBalance === null ? null : round2(closingBalance),
    minBalance: minBalance === null ? null : round2(minBalance),
    daysCovered: Math.min(daysCovered, daysInMonth),
    /*
     * Un mes se da por completo con 28 días cubiertos y no con los 30 exactos.
     * Febrero tiene 28, y un extracto que va del 1 de enero al 31 de marzo puede
     * declarar como último día el 30 según cómo el banco cierre el periodo.
     * Exigir el mes al día haría que la cobertura dependiera de la costumbre de
     * cada banco al imprimir la fecha final.
     */
    complete: daysCovered >= Math.min(28, daysInMonth),
  };
}
