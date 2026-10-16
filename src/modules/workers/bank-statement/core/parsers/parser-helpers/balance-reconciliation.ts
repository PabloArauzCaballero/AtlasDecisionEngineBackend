import type { BankTransaction } from '../../domain/models';

/**
 * Sentido en el que el banco imprimió las filas.
 *
 * No todos los formatos van del movimiento más antiguo al más reciente:
 * BancoSol y Banco Unión imprimen al revés. Suponer siempre orden ascendente
 * haría que la conciliación de saldo esperase el paso equivocado entre filas y
 * degradase la confianza de un extracto correcto.
 */
function isNewestFirst(transactions: readonly BankTransaction[]): boolean {
  const dates = transactions.map((transaction) => transaction.transactionDate).filter(Boolean);
  const first = dates[0];
  const last = dates.at(-1);
  return Boolean(first && last && first > last);
}

/**
 * Verifies that each transaction's balance follows from the previous one
 * plus its signed amount. Parsers derive debit/credit/amount and balance
 * from independent numeric tokens on the same line; a misaligned column or a
 * silently dropped row shows up here as a broken running total even though
 * every individual field still looked well-formed on its own. Mismatches
 * degrade the affected transaction's confidence instead of failing the whole
 * statement, since legitimate non-transactional postings (fees, interest)
 * can also produce a jump the parser didn't itemize as its own row.
 */
export function reconcileRunningBalance(transactions: readonly BankTransaction[]): number {
  // El saldo de una cuenta no continúa el de otra: en un documento que publica
  // varias, cada frontera parecería una ruptura. La segmentación vive AQUÍ y no
  // en quien llama porque hay más de un sitio que concilia —el servicio para
  // registrar la incidencia, las validaciones para puntuarla— y dos de ellos
  // corrigiéndolo por separado es la forma de que un tercero nazca sin corregir.
  return consecutiveByAccount(transactions).reduce(
    (total, group) => total + reconcileOneAccount(group),
    0,
  );
}

/**
 * Los movimientos en tramos CONSECUTIVOS de la misma cuenta.
 *
 * Consecutivos y no agrupados: un documento imprime cada cuenta entera antes de
 * pasar a la siguiente, y lo que se comprueba sobre ellos —que un saldo
 * continúe el anterior, que las fechas avancen— es una propiedad del orden en
 * que están impresos. Reagruparlos rompería esa relación en vez de conservarla.
 *
 * Sin cuenta en los movimientos —el caso normal, un documento con una sola—
 * sale un único tramo con todo, que es exactamente lo que se hacía antes.
 */
export function consecutiveByAccount(
  transactions: readonly BankTransaction[],
): readonly (readonly BankTransaction[])[] {
  const groups: BankTransaction[][] = [];
  let current: BankTransaction[] | undefined;
  let account: string | undefined;

  for (const transaction of transactions) {
    if (!current || transaction.account !== account) {
      current = [];
      account = transaction.account;
      groups.push(current);
    }
    current.push(transaction);
  }
  return groups;
}

function reconcileOneAccount(transactions: readonly BankTransaction[]): number {
  const newestFirst = isNewestFirst(transactions);
  let mismatches = 0;
  for (let index = 1; index < transactions.length; index += 1) {
    const previous = transactions[index - 1];
    const current = transactions[index];
    if (!previous || !current) continue;
    // En un extracto impreso del más reciente al más antiguo, el saldo de la
    // fila siguiente es el que había **antes** del movimiento de la anterior:
    // el paso que las une es el importe de la fila previa, restado.
    const step = newestFirst ? previous.amount : current.amount;
    if (!previous.balance || !current.balance || !step) continue;
    const previousBalance = Number(previous.balance);
    const currentBalance = Number(current.balance);
    const amount = Number(step);
    if (
      !Number.isFinite(previousBalance) ||
      !Number.isFinite(currentBalance) ||
      !Number.isFinite(amount)
    ) {
      continue;
    }
    const expectedBalance = Number(
      (newestFirst ? previousBalance - amount : previousBalance + amount).toFixed(2),
    );
    if (Math.abs(expectedBalance - currentBalance) > 0.01) {
      mismatches += 1;
      current.extractionConfidence = Math.min(
        Number(current.extractionConfidence || '1'),
        0.4,
      ).toFixed(2);
    }
  }
  return mismatches;
}

/**
 * Confianza máxima que se deja a una fila cuya descripción es un valor atípico.
 *
 * Se distingue del `0.40` de la ruptura de saldo a propósito: son dos señales
 * distintas y quien audita debe poder separarlas. Una ruptura de saldo apunta a
 * una columna mal leída; una descripción atípica, a texto ajeno absorbido.
 */
const ANOMALOUS_DESCRIPTION_CONFIDENCE = 0.55;

/** Un extracto con menos filas no da una mediana con la que comparar. */
const MINIMUM_SAMPLE = 8;

/** Factor sobre la mediana a partir del cual una descripción es atípica. */
const OUTLIER_FACTOR = 5;

/** Suelo absoluto: una glosa larga de verdad no debe penalizarse. */
const OUTLIER_FLOOR = 80;

/**
 * Marca las filas cuya descripción se sale del patrón del propio extracto.
 *
 * `transactionConfidence` solo mide qué campos se obtuvieron, de modo que en un
 * formato que siempre los imprime todos —el de BCP, por ejemplo— devolvía
 * `1.00` en el 100 % de las filas y no informaba de nada. Un extracto real lo
 * dejó en evidencia: la última fila había absorbido la sección de resumen del
 * PDF, con 160 caracteres de descripción frente a una mediana de 14, y aun así
 * salía con confianza máxima.
 *
 * La comparación es **contra el propio documento**, no contra un umbral fijo:
 * cada banco tiene su propia verbosidad, y lo que delata un fallo de análisis es
 * que una fila se aparte de sus vecinas. Detecta la clase de regresión que
 * introduce texto ajeno en un movimiento, en cualquier analizador.
 *
 * @returns cuántas filas resultaron atípicas.
 */
export function flagAnomalousDescriptions(transactions: readonly BankTransaction[]): number {
  if (transactions.length < MINIMUM_SAMPLE) return 0;

  const lengths = transactions
    .map((transaction) => transaction.description.length)
    .sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)] ?? 0;
  const threshold = Math.max(OUTLIER_FLOOR, median * OUTLIER_FACTOR);

  let flagged = 0;
  for (const transaction of transactions) {
    if (transaction.description.length <= threshold) continue;
    flagged += 1;
    transaction.extractionConfidence = Math.min(
      Number(transaction.extractionConfidence || '1'),
      ANOMALOUS_DESCRIPTION_CONFIDENCE,
    ).toFixed(2);
  }
  return flagged;
}

export function transactionDateRange(transactions: readonly BankTransaction[]): {
  start: string;
  end: string;
} {
  const dates = transactions
    .map((transaction) => transaction.transactionDate)
    .filter(Boolean)
    .sort();
  return {
    start: dates[0] ?? '',
    end: dates.at(-1) ?? '',
  };
}
