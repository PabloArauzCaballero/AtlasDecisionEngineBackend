/**
 * El saldo día a día, que no es lo mismo que el saldo más bajo.
 *
 * ## El contraejemplo que obliga a tener las dos medidas
 *
 * Dos cuentas, treinta días, el mismo mínimo:
 *
 * | cuenta | 29 días | 1 día | mínimo | media ponderada |
 * | ------ | ------- | ----- | ------ | --------------- |
 * | A      | 10.000  | 0     | **0**  | **9.666,67**    |
 * | B      | 0       | 0     | **0**  | **0**           |
 *
 * El mínimo dice que son idénticas. Y no lo son: la primera tuvo diez mil
 * bolivianos disponibles casi todo el mes y un día de paso a cero; la segunda no
 * tuvo nada nunca. Un motor que sólo mire el mínimo trata igual a quien tiene
 * colchón y a quien no lo tiene, y el corpus lo fija como caso de regresión
 * (`MEAN_NOT_MIN`) precisamente porque es el error que parece inofensivo.
 *
 * Al revés también falla: sólo la media esconde a quien pasa quince días en
 * rojo y cobra el día 30. Por eso se publican las dos, más los días bajo cero y
 * los EPISODIOS de sobregiro — que no son lo mismo que los días, y contarlos
 * como si lo fueran multiplica por diez un solo tropiezo.
 *
 * ## La imputación diaria, y su límite
 *
 * Un extracto no trae el saldo de cada día: trae el saldo después de cada
 * movimiento. El saldo de un día sin movimientos es el del último apunte
 * anterior, y así se imputa. Lo que NO se hace es inventar los días anteriores
 * al primer saldo conocido: ésos no se cubren y no entran en el denominador,
 * porque el saldo de un día que nadie observó no es cero — es desconocido, que
 * es la distinción que gobierna todo este módulo.
 */

import type { ClassifiedMovement } from './monthly-series';

const MILLISECONDS_PER_DAY = 86_400_000;

export interface BalanceSeries {
  /** Días con saldo conocido. Es el denominador de la media. */
  readonly daysCovered: number;
  /** `sum(saldo_cierre_día) / días_cubiertos`, o `null` sin ningún saldo. */
  readonly timeWeightedMean: number | null;
  /** El saldo de cierre más bajo observado. */
  readonly minimum: number | null;
  /** Días cuyo saldo de cierre quedó por debajo de cero. */
  readonly negativeDays: number;
  /**
   * Veces que la cuenta CRUZÓ a negativo.
   *
   * Un episodio de doce días es un episodio, no doce. Contar días como eventos
   * convierte un descubierto largo en una docena de incidencias y hace ilegible
   * la diferencia con quien se descubre una vez al mes.
   */
  readonly overdraftEpisodes: number;
  /** El último saldo conocido del periodo. */
  readonly closing: number | null;
}

const EMPTY: BalanceSeries = {
  daysCovered: 0,
  timeWeightedMean: null,
  minimum: null,
  negativeDays: 0,
  overdraftEpisodes: 0,
  closing: null,
};

/**
 * Construye la serie diaria imputando hacia adelante el último saldo conocido.
 *
 * @param movements Movimientos ya clasificados, con fecha y saldo cuando el
 * emisor lo imprime. Los que no traen saldo no rompen la serie: simplemente no
 * la mueven.
 * @param window La ventana observada del extracto. La serie no se extiende ni un
 * día más allá, ni siquiera para «completar» el mes.
 */
export function buildBalanceSeries(
  movements: readonly ClassifiedMovement[],
  window: { from: Date; to: Date } | null,
): BalanceSeries {
  if (!window) return EMPTY;

  /*
   * El saldo de cierre de cada día con movimientos: el del ÚLTIMO apunte.
   *
   * Los movimientos llegan en el orden del documento, que es el de lectura, y
   * dentro de un mismo día el último renglón es el que deja el saldo con el que
   * el día termina. Reordenar por importe o por glosa rompería esa propiedad.
   */
  const closingByDay = new Map<string, number>();
  for (const movement of movements) {
    if (movement.balance === null || !Number.isFinite(movement.balance)) continue;
    if (!movement.date) continue;
    closingByDay.set(movement.date.slice(0, 10), movement.balance);
  }
  if (closingByDay.size === 0) return EMPTY;

  const firstKnown = [...closingByDay.keys()].sort()[0];
  let sum = 0;
  let days = 0;
  let minimum: number | null = null;
  let negativeDays = 0;
  let episodes = 0;
  let previousNegative = false;
  let carried: number | null = null;
  let closing: number | null = null;

  for (
    let cursor = new Date(window.from.getTime());
    cursor <= window.to;
    cursor = new Date(cursor.getTime() + MILLISECONDS_PER_DAY)
  ) {
    const day = cursor.toISOString().slice(0, 10);
    const observed = closingByDay.get(day);
    if (observed !== undefined) carried = observed;
    // Antes del primer saldo conocido no se imputa nada: no es cero, es que no
    // se observó.
    if (carried === null || day < firstKnown) continue;

    sum += carried;
    days += 1;
    closing = carried;
    minimum = minimum === null ? carried : Math.min(minimum, carried);
    const negative = carried < 0;
    if (negative) {
      negativeDays += 1;
      if (!previousNegative) episodes += 1;
    }
    previousNegative = negative;
  }

  if (days === 0) return EMPTY;

  return {
    daysCovered: days,
    timeWeightedMean: sum / days,
    minimum,
    negativeDays,
    overdraftEpisodes: episodes,
    closing,
  };
}
