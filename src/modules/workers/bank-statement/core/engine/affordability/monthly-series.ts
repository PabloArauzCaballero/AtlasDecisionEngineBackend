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

import { normalizeGloss } from './movement-lexicon';
import type { MonthlyBucket, PeriodCoverage } from './affordability-model';
import {
  classifyInflow,
  classifyOutflow,
  isNsf,
  officialCategoryToKind,
  COMMITTED_OUTFLOWS,
  THIRD_PARTY_OBLIGATIONS,
  RECOGNIZED_INFLOWS,
  type InflowKind,
  type OutflowKind,
} from './movement-lexicon';
import {
  directionCoherence,
  lookupOfficialGlossary,
  type DirectionCoherence,
  type GlossaryLookup,
} from './official-glossary';
import type { TratamientoDeIngreso } from '../../corpus/corpus-extractos.generated';
import { round2 } from './statistics';

/** Un movimiento, reducido a lo que la capacidad de pago necesita de él. */
export interface AffordabilityTransaction {
  /** `AAAA-MM-DD`, o `null` si no se pudo leer la fecha. */
  readonly date: string | null;
  readonly description: string;
  readonly debit: number | null;
  readonly credit: number | null;
  readonly balance: number | null;
}

/** Un movimiento ya clasificado. Lo consume el resto del módulo. */
export interface ClassifiedMovement extends AffordabilityTransaction {
  readonly month: string;
  readonly day: number;
  readonly amount: number;
  readonly direction: 'INFLOW' | 'OUTFLOW';
  readonly kind: string;
  readonly nsf: boolean;
  /** Glosa normalizada y recortada: la clave con la que se detecta recurrencia. */
  readonly label: string;
  /** Quién nombró el movimiento: el glosario del emisor o nuestro léxico. */
  readonly classifiedBy: 'OFFICIAL_GLOSSARY' | 'LOCAL_LEXICON';
  /** Categorías analíticas del glosario oficial. Vacío si no casó ninguna. */
  readonly officialCategories: readonly string[];
  /** Lo que el glosario permite hacer con este importe al medir ingreso. */
  readonly officialIncomeTreatment: TratamientoDeIngreso | null;
  /** La fila contra lo que el emisor declara para esa glosa. Nunca cambia el lado. */
  readonly directionCoherence: DirectionCoherence;
}

const MILLISECONDS_PER_DAY = 86_400_000;

/** Lo que hay que saber del documento para consultar el glosario de su emisor. */
export interface MovementClassificationContext {
  /** Sigla ASFI del emisor del extracto, cuando se pudo resolver. */
  readonly issuerCode?: string | null;
}

/**
 * El glosario oficial puede QUITAR el reconocimiento de ingreso, nunca darlo.
 *
 * Es la regla que resuelve el caso incómodo: `PagoHAB` tiene categoría
 * `SALARY_PAYMENT` y sin embargo su tratamiento es `DO_NOT_ASSUME_INCOME`,
 * porque desde la cuenta de una empresa esa glosa es la planilla que PAGA, no el
 * sueldo que cobra. Leer la categoría y olvidar el tratamiento convertiría la
 * nómina de un empleador en su propio ingreso.
 *
 * Sólo `SALARY_CANDIDATE_REQUIRES_CREDIT_AND_VERIFICATION` —tres glosas de las
 * 147— autoriza a llamar nómina a un abono, y aun así la condición del nombre se
 * comprueba aparte: tiene que ser un abono de verdad, mirando la columna.
 */
function resolveKind(
  direction: 'INFLOW' | 'OUTFLOW',
  description: string,
  lookup: GlossaryLookup,
): { kind: InflowKind | OutflowKind; by: 'OFFICIAL_GLOSSARY' | 'LOCAL_LEXICON' } {
  const heuristic =
    direction === 'INFLOW' ? classifyInflow(description) : classifyOutflow(description);

  if (lookup.matches.length === 0) return { kind: heuristic, by: 'LOCAL_LEXICON' };

  const mapped =
    lookup.categories
      .map((category) => officialCategoryToKind(category, direction))
      .find((kind): kind is InflowKind | OutflowKind => kind !== null) ?? null;

  const allowsIncome =
    lookup.incomeTreatment === 'SALARY_CANDIDATE_REQUIRES_CREDIT_AND_VERIFICATION';

  const chosen = mapped ?? heuristic;
  const by: 'OFFICIAL_GLOSSARY' | 'LOCAL_LEXICON' = mapped ? 'OFFICIAL_GLOSSARY' : 'LOCAL_LEXICON';

  /*
   * Un PREFIJO no basta para quitarle a nadie su ingreso.
   *
   * La regla de arriba —el glosario puede retirar el reconocimiento de ingreso—
   * vale cuando el literal del emisor ES la glosa. Cuando sólo casa por prefijo,
   * el resto de la glosa sigue diciendo cosas, y a veces dice lo importante.
   *
   * Medido sobre un extracto real del BCP con 112 movimientos: 75 casan con el
   * glosario y la mayoría son del tipo `Transferencia QR BM QR Restotech
   * Ventaid`. El literal oficial que casa es `TRANSFERENCIA`, que el corpus
   * anota como `DO_NOT_ASSUME_INCOME` — correcto para «una transferencia» y
   * demasiado ancho para ésta, donde `QR` y el nombre del comercio dicen que es
   * el cobro de una venta. Sin esta excepción, la capacidad de pago de cualquier
   * comerciante que cobra por QR se hundía por la primera palabra de su glosa.
   *
   * La excepción es estrecha a propósito: sólo cubre el caso en que el léxico
   * local encontró algo MÁS específico dentro de la misma glosa. El literal
   * exacto, la alternativa declarada y la plantilla del emisor siguen mandando.
   */
  const soloPorPrefijo = lookup.matches.every((match) => match.kind === 'PREFIX');
  const elLexicoFueMasEspecifico = mapped === null && RECOGNIZED_INFLOWS.has(heuristic as never);

  if (
    direction === 'INFLOW' &&
    !allowsIncome &&
    RECOGNIZED_INFLOWS.has(chosen as never) &&
    !(soloPorPrefijo && elLexicoFueMasEspecifico)
  ) {
    // El emisor no dice que esto sea ingreso: no lo es por mucho que la glosa
    // se parezca a una nómina.
    return { kind: 'ONE_OFF', by: 'OFFICIAL_GLOSSARY' };
  }
  return { kind: chosen, by };
}

/**
 * Clasifica los movimientos y descarta los que no dicen nada.
 *
 * Un movimiento SIN FECHA se descarta entero, y es deliberado: no se le puede
 * asignar mes, así que contarlo en el total pero no en ninguna serie mensual
 * haría que la suma de los meses no cuadrara con el total del periodo — que es
 * justo la incoherencia que hace desconfiar de un informe.
 *
 * El `contexto` es opcional y lo que aporta es el EMISOR: con él, las glosas de
 * un banco con glosario publicado se resuelven contra el glosario publicado en
 * vez de contra nuestras palabras. Sin él, todo sigue funcionando como antes.
 */
export function classifyMovements(
  transactions: readonly AffordabilityTransaction[],
  context: MovementClassificationContext = {},
): ClassifiedMovement[] {
  const out: ClassifiedMovement[] = [];
  for (const transaction of transactions) {
    const date = parseIsoDate(transaction.date);
    if (!date) continue;

    const credit = Math.abs(transaction.credit ?? 0);
    const debit = Math.abs(transaction.debit ?? 0);
    const direction: 'INFLOW' | 'OUTFLOW' = credit >= debit ? 'INFLOW' : 'OUTFLOW';
    const amount = direction === 'INFLOW' ? credit : debit;

    const lookup = lookupOfficialGlossary(context.issuerCode, transaction.description);
    const resolved = resolveKind(direction, transaction.description, lookup);

    out.push({
      ...transaction,
      month: transaction.date!.slice(0, 7),
      day: date.getUTCDate(),
      amount,
      direction,
      kind: resolved.kind,
      nsf: isNsf(transaction.description),
      label: streamLabel(transaction.description),
      classifiedBy: resolved.by,
      officialCategories: lookup.categories,
      officialIncomeTreatment: lookup.incomeTreatment,
      directionCoherence: directionCoherence(lookup, direction),
    });
  }
  return out;
}

/**
 * Etiqueta con la que dos apariciones del mismo compromiso se reconocen entre
 * sí.
 *
 * Se quedan las palabras y se van los números. Es lo importante: la glosa de una
 * cuota lleva el número de operación, el de cuota y a veces la fecha, y todos
 * cambian cada mes. «PAGO CUOTA PRESTAMO 4412 03/26» y «PAGO CUOTA PRESTAMO 4412
 * 04/26» son el mismo compromiso, y comparando la glosa entera no lo parecen.
 *
 * Se recorta a seis palabras porque a partir de ahí las glosas largas incorporan
 * el nombre del comercio o la sucursal, que varían dentro del mismo compromiso.
 */
export function streamLabel(description: string): string {
  return normalizeGloss(description)
    .replace(/\d+[\d/.,:-]*/g, ' ')
    .replace(/[^a-z ñ]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 6)
    .join(' ')
    .trim();
}

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

function monthsBetween(from: Date, to: Date): string[] {
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

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
