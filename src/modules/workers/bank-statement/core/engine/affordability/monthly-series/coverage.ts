import type { MonthlyBucket, PeriodCoverage } from '../affordability-model';
import { ClassifiedMovement, MILLISECONDS_PER_DAY } from './types';

/**
 * Qué periodo cubre el extracto de verdad, frente a lo que exige la política.
 *
 * La ventana sale de los MOVIMIENTOS y no de las fechas impresas en la carátula
 * cuando las dos discrepan hacia menos: un extracto que dice cubrir enero a
 * marzo y cuyo último apunte es del 4 de febrero no cubre tres meses, dice que
 * los cubre. La carátula sí manda cuando es más ANCHA —un mes sin movimientos
 * es un mes cubierto y vacío, no un mes ausente—, y por eso los huecos se
 * cuentan aparte en vez de descontarse.
 */
export function assessCoverage(
  movements: readonly ClassifiedMovement[],
  months: readonly MonthlyBucket[],
  printedPeriod: { from: string | null; to: string | null },
  minimumMonths: number,
): PeriodCoverage {
  const window = observationWindow(movements, printedPeriod);
  /*
   * La cobertura sigue exigiendo ACTIVIDAD, y eso es deliberado.
   *
   * Ahora que los meses vacíos existen en la serie, contarlos aquí dejaría que
   * un extracto con un solo mes real y dos meses en blanco cumpliera un mínimo
   * de tres. Lo que sí se hace —que es lo que el corpus pide— es publicar los
   * dos números por separado: cobertura documental y actividad no son lo mismo,
   * y «poca actividad» no demuestra «poco ingreso».
   */
  const monthsComplete = months.filter(
    (month) => month.complete && month.transactionCount > 0,
  ).length;
  const monthsCoveredWithoutActivity = months.filter(
    (month) => month.complete && month.transactionCount === 0,
  ).length;

  const gapMonths = window
    ? monthsBetween(window.from, window.to).filter(
        (month) => !months.some((bucket) => bucket.month === month && bucket.transactionCount > 0),
      )
    : [];

  return {
    minimumMonthsRequired: minimumMonths,
    monthsObserved: months.filter((month) => month.transactionCount > 0).length,
    monthsComplete,
    from: window ? isoDay(window.from) : null,
    to: window ? isoDay(window.to) : null,
    daysSpanned: window
      ? Math.round((window.to.getTime() - window.from.getTime()) / MILLISECONDS_PER_DAY) + 1
      : 0,
    satisfied: monthsComplete >= minimumMonths,
    monthsCoveredWithoutActivity,
    gapMonths,
  };
}

/**
 * La ventana observada: la unión de lo que imprime la carátula y lo que abarcan
 * los movimientos, recortada por el primer y el último apunte cuando la carátula
 * promete más de lo que entrega.
 */
export function observationWindow(
  movements: readonly ClassifiedMovement[],
  printedPeriod: { from: string | null; to: string | null },
): { from: Date; to: Date } | null {
  const dates = movements
    .map((movement) => parseIsoDate(movement.date))
    .filter((date): date is Date => date !== null)
    .sort((left, right) => left.getTime() - right.getTime());

  const printedFrom = parseIsoDate(printedPeriod.from);
  const printedTo = parseIsoDate(printedPeriod.to);

  const first = dates[0] ?? printedFrom;
  const last = dates[dates.length - 1] ?? printedTo;
  if (!first || !last) return null;

  /*
   * La carátula ensancha hacia atrás y hacia adelante SÓLO si sus fechas son
   * coherentes con los movimientos. Un `periodStart` anterior al primer apunte
   * es información real —el mes empezó sin movimientos—; uno posterior al último
   * apunte sería una fecha mal leída, y ensanchar con ella regalaría cobertura.
   */
  const from = printedFrom && printedFrom < first && printedFrom <= last ? printedFrom : first;
  const to = printedTo && printedTo > last && printedTo >= first ? printedTo : last;
  return from <= to ? { from, to } : null;
}

export function monthsBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (cursor <= to) {
    out.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
