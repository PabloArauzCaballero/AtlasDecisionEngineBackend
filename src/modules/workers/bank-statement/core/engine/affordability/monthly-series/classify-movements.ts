import { normalizeGloss } from '../movement-lexicon';
import {
  classifyInflow,
  classifyOutflow,
  isNsf,
  officialCategoryToKind,
  RECOGNIZED_INFLOWS,
  type InflowKind,
  type OutflowKind,
} from '../movement-lexicon';
import {
  directionCoherence,
  lookupOfficialGlossary,
  type GlossaryLookup,
} from '../official-glossary';
import { parseIsoDate } from './coverage';
import {
  AffordabilityTransaction,
  ClassifiedMovement,
  MovementClassificationContext,
} from './types';

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
