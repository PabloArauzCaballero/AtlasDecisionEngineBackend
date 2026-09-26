/**
 * Qué se REPITE en el extracto, que es lo que separa un ingreso de un cobro y
 * una obligación de una compra.
 *
 * ## Por qué la recurrencia decide más que la glosa
 *
 * Porque la glosa es opcional y la cadencia no. Un sueldo pagado por
 * transferencia entre particulares llega como «TRANSFERENCIA RECIBIDA» y no dice
 * nada; el mismo importe, el mismo remitente y el mismo día del mes, tres meses
 * seguidos, lo dice todo. Al revés: un abono que dice «PAGO» y aparece una sola
 * vez no es un ingreso por mucho que su glosa lo sugiera.
 *
 * Esto es lo que rescata a la mayor parte de los trabajadores por cuenta propia
 * de Bolivia, que es a quien peor trata un modelo de nómina: no tienen planilla,
 * cobran por QR y por transferencia, y su ingreso es perfectamente reconocible
 * en cuanto se mira la cadencia en vez del rótulo.
 *
 * ## Y por qué exige TRES apariciones en TRES meses distintos
 *
 * Dos apariciones no son una serie: cualquier par de cobros parecidos las
 * produce. Tres en tres meses distintos es lo mínimo que descarta la coincidencia
 * y, no por casualidad, es la misma exigencia de meses que gobierna todo el
 * módulo — con dos meses de extracto no se puede afirmar que nada sea recurrente,
 * y ésa es una de las razones por las que dos meses no bastan.
 */

import type { RecurringStream } from './affordability-model';
import type { InflowKind, OutflowKind } from './movement-lexicon';
import type { ClassifiedMovement } from './monthly-series';
import { coefficientOfVariation, median, round2, round4 } from './statistics';

/** Apariciones mínimas para llamar recurrente a un flujo. */
const MINIMUM_OCCURRENCES = 3;
/** Meses distintos mínimos. Tres cobros en el mismo mes no son una cadencia. */
const MINIMUM_MONTHS = 3;
/**
 * Dispersión máxima del importe entre apariciones.
 *
 * 60 % es holgado a propósito. Una cuota de préstamo es idéntica cada mes y una
 * factura de luz varía un 30 % con la estación; el ingreso de un comerciante
 * varía mucho más. Apretar el umbral dejaría fuera justo los flujos variables
 * que este módulo existe para reconocer, y el castigo por variabilidad ya se
 * aplica después, sobre el ingreso, en vez de aquí en forma de exclusión.
 */
const MAXIMUM_VARIABILITY = 0.6;

/**
 * Encuentra los flujos que se repiten, en una dirección.
 *
 * @param monthsInStatement Meses del extracto. Se usa para pasar el importe
 * observado a MENSUAL: un compromiso quincenal aparece seis veces en tres meses
 * y su importe mensual es el doble de cada aparición, mientras que uno trimestral
 * aparece una vez y no puede contarse entero contra un solo mes.
 */
export function findRecurringStreams(
  movements: readonly ClassifiedMovement[],
  direction: 'INFLOW' | 'OUTFLOW',
  monthsInStatement: number,
): RecurringStream[] {
  const groups = new Map<string, ClassifiedMovement[]>();
  for (const movement of movements) {
    if (movement.direction !== direction) continue;
    if (movement.label.length === 0) continue;
    const group = groups.get(movement.label);
    if (group) group.push(movement);
    else groups.set(movement.label, [movement]);
  }

  const months = Math.max(1, monthsInStatement);
  const streams: RecurringStream[] = [];

  for (const [label, items] of groups) {
    const distinctMonths = new Set(items.map((item) => item.month));
    if (items.length < MINIMUM_OCCURRENCES || distinctMonths.size < MINIMUM_MONTHS) continue;

    const amounts = items.map((item) => item.amount);
    const variability = coefficientOfVariation(amounts);
    if (variability > MAXIMUM_VARIABILITY) continue;

    const medianAmount = median(amounts) ?? 0;
    /*
     * El importe mensual sale del TOTAL repartido entre los meses del extracto,
     * no de la mediana. Es la diferencia entre «cuánto es cada cobro» y «cuánto
     * pesa al mes», y sólo la segunda sirve para restar de un ingreso mensual:
     * dos cuotas quincenales de 500 comprometen 1.000 al mes, no 500.
     */
    const total = amounts.reduce((sum, amount) => sum + amount, 0);

    streams.push({
      label,
      direction,
      kind: dominantKind(items),
      monthsSeen: distinctMonths.size,
      medianAmount: round2(medianAmount),
      monthlyAmount: round2(total / months),
      variability: round4(variability),
      lastSeenMonth: [...distinctMonths].sort().at(-1) ?? null,
      occurrences: items.length,
    });
  }

  return streams.sort((left, right) => right.monthlyAmount - left.monthlyAmount);
}

/**
 * La categoría que más dinero aporta dentro del grupo, no la más frecuente.
 *
 * Un grupo puede mezclar clasificaciones cuando la glosa varía —«PAGO CUOTA» un
 * mes y «PAGO CUOTA PRESTAMO» al siguiente—. Lo que define al flujo es dónde
 * está el dinero: contar apariciones haría que tres cargos pequeños mal
 * clasificados mandaran sobre uno grande bien clasificado.
 */
function dominantKind(items: readonly ClassifiedMovement[]): InflowKind | OutflowKind {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.kind, (totals.get(item.kind) ?? 0) + item.amount);
  }
  const dominant = [...totals.entries()].sort(([, left], [, right]) => right - left)[0]?.[0];
  return (dominant ?? 'DISCRETIONARY') as InflowKind | OutflowKind;
}

/**
 * Las etiquetas de abonos recurrentes que la glosa NO había reconocido.
 *
 * Es lo que se devuelve al agrupado mensual para que los rescate como ingreso.
 * Se limita a los que la glosa dejó en `ONE_OFF`: los que ya se reconocieron no
 * necesitan rescate, y los que se clasificaron como desembolso de crédito,
 * reverso o traspaso interno están EXCLUIDOS por una razón que la recurrencia no
 * anula — un préstamo mensual sigue sin ser un ingreso por mucho que llegue todos
 * los meses.
 */
export function recognizableByCadence(
  movements: readonly ClassifiedMovement[],
  monthsInStatement: number,
): Set<string> {
  const candidates = movements.filter(
    (movement) => movement.direction === 'INFLOW' && movement.kind === 'ONE_OFF',
  );
  return new Set(
    findRecurringStreams(candidates, 'INFLOW', monthsInStatement).map((stream) => stream.label),
  );
}
