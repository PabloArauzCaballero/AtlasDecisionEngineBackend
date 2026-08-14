import type {
  BankTransaction,
  CurrencyCode,
  PageLine,
  StatementMetadata,
  TextToken,
} from '../domain/models';

const MONTHS: Readonly<Record<string, string>> = {
  ene: '01',
  feb: '02',
  mar: '03',
  abr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  ago: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dic: '12',
  enero: '01',
  febrero: '02',
  marzo: '03',
  abril: '04',
  mayo: '05',
  junio: '06',
  julio: '07',
  agosto: '08',
  septiembre: '09',
  octubre: '10',
  noviembre: '11',
  diciembre: '12',
};

export const EMPTY_METADATA: StatementMetadata = {
  institutionCode: '',
  institutionName: '',
  accountNumber: '',
  accountCurrency: 'UNKNOWN',
  accountHolder: '',
  periodStart: '',
  periodEnd: '',
  openingBalance: '',
  closingBalance: '',
};

/**
 * Extrae un saldo rotulado del texto de cabecera y lo normaliza.
 *
 * Devuelve cadena vacía si el rótulo no aparece o si el valor que lo sigue no
 * es un decimal bien formado: un saldo inventado sería peor que su ausencia,
 * porque invalidaría en silencio la comprobación de cuadre que habilita.
 */
export function labeledBalance(text: string, label: RegExp): string {
  const raw = text.match(label)?.[1];
  return raw ? normalizeNumeric(raw) : '';
}

export function textInRange(line: PageLine, startRatio: number, endRatio: number): string {
  return line.tokens
    .filter((token) => {
      const ratio = token.x / line.pageWidth;
      return ratio >= startRatio && ratio < endRatio;
    })
    .map((token) => token.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokensInRange(line: PageLine, startRatio: number, endRatio: number): TextToken[] {
  return line.tokens.filter((token) => {
    const ratio = token.x / line.pageWidth;
    return ratio >= startRatio && ratio < endRatio;
  });
}

export function normalizeNumeric(value: string): string {
  const normalized = value.trim().replace(/[+]/g, '').replace(/\s/g, '').replace(/,/g, '');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return '';
  }
  return Number(normalized).toFixed(2);
}

/**
 * Normaliza un importe que viaja con su divisa pegada en la misma ficha de
 * texto: `-Bs 50.00`, `+Bs 1,234.56`, `Bs 0.00`.
 *
 * Se separa de `normalizeNumeric()` en lugar de ampliarla porque esa función
 * también hace de filtro: es la que descarta las fichas que **no** son cifras al
 * recorrer una línea. Si aceptara rótulos de divisa, un encabezado como
 * `Monto (Bs)` empezaría a colarse como valor en todos los analizadores.
 *
 * Devuelve cadena vacía si la ficha no tiene exactamente esa forma.
 */
export function normalizeLabeledAmount(value: string): string {
  const match = value.trim().match(/^([+-]?)\s*(?:Bs|\$us|USD)\s*([\d,]+(?:\.\d{1,2})?)$/i);
  if (!match) return '';
  return normalizeNumeric(`${match[1] ?? ''}${match[2] ?? ''}`);
}

export function splitAmount(amount: string): Pick<BankTransaction, 'debit' | 'credit' | 'amount'> {
  const normalized = normalizeNumeric(amount);
  if (!normalized) {
    return { debit: '', credit: '', amount: '' };
  }
  const numeric = Number(normalized);
  return {
    debit: numeric < 0 ? Math.abs(numeric).toFixed(2) : '',
    credit: numeric > 0 ? numeric.toFixed(2) : '',
    amount: numeric.toFixed(2),
  };
}

function validIsoDate(yearText: string, monthText: string, dayText: string): string {
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    !Number.isInteger(year) ||
    year < 1 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > (daysByMonth[month - 1] ?? 0)
  ) {
    return '';
  }
  return `${yearText.padStart(4, '0')}-${monthText.padStart(2, '0')}-${dayText.padStart(2, '0')}`;
}

export function toIsoDate(value: string): string {
  const yearFirst = value.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (yearFirst) {
    return validIsoDate(yearFirst[1] ?? '', yearFirst[2] ?? '', yearFirst[3] ?? '');
  }

  const numeric = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (numeric) {
    return validIsoDate(numeric[3] ?? '', numeric[2] ?? '', numeric[1] ?? '');
  }

  // `DD-MM-YYYY`, con la que BancoSol fecha sus movimientos. El día va primero,
  // como en el resto de las formas admitidas y como lo escribe el propio banco
  // en el nombre de sus archivos (`…-20-02-2026.pdf`).
  const hyphenated = value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (hyphenated) {
    return validIsoDate(hyphenated[3] ?? '', hyphenated[2] ?? '', hyphenated[1] ?? '');
  }

  // Forma redactada, «01 de junio, 2026» o «01 de junio de 2026», con la que el
  // Banco Nacional de Bolivia rotula el período y sus saldos.
  const spelled = value
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})\s+de\s+([a-záéíóú]+),?\s+(?:de\s+)?(\d{4})$/i);
  if (spelled) {
    const month = MONTHS[spelled[2]?.normalize('NFD').replace(/\p{Diacritic}/gu, '') ?? ''];
    return month ? validIsoDate(spelled[3] ?? '', month, spelled[1] ?? '') : '';
  }

  const named = value
    .toLowerCase()
    .replace(/\./g, '')
    .match(/^(\d{1,2})\/([a-záéíóú]+)\/(\d{4})$/i);
  if (!named) {
    return '';
  }
  const month = MONTHS[named[2]?.normalize('NFD').replace(/\p{Diacritic}/gu, '') ?? ''];
  return month ? validIsoDate(named[3] ?? '', month, named[1] ?? '') : '';
}

export function monthPeriod(value: string): {
  start: string;
  end: string;
} {
  const match = value
    .trim()
    .toLowerCase()
    .match(/([a-záéíóú]+)\s+(\d{4})/i);
  if (!match) {
    return { start: '', end: '' };
  }
  const month = MONTHS[match[1]?.normalize('NFD').replace(/\p{Diacritic}/gu, '') ?? ''];
  if (!month) {
    return { start: '', end: '' };
  }
  const year = Number(match[2]);
  const monthNumber = Number(month);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate().toString().padStart(2, '0');
  return {
    start: `${year}-${month}-01`,
    end: `${year}-${month}-${lastDay}`,
  };
}

/**
 * `M/N` («moneda nacional») es la única abreviatura que se acepta como divisa:
 * nombra el boliviano sin ambigüedad y es como el Banco Unión rotula el
 * producto. Su contraparte `M/E` («moneda extranjera») **no** se traduce a
 * `USD` a propósito: nombra una categoría, no una divisa, y devolver `UNKNOWN`
 * es preferible a suponer cuál es.
 *
 * Los códigos ISO se admiten en las DOS divisas. `USD` estaba desde el
 * principio y `BOB` no, así que una carátula que rotulaba «Moneda: BOB» —la
 * forma en que la escribe cualquier documento generado por máquina— salía como
 * `UNKNOWN` mientras la misma carátula en dólares se leía sin problema. La
 * asimetría no respondía a ninguna decisión: era el código que falta.
 */
export function currencyFromText(value: string): CurrencyCode {
  if (/bolivianos|\(bs\)|\bBS\b|\bBOB\b|\bM\/N\b/i.test(value)) return 'BOB';
  if (/d[oó]lares|\busd\b|\$us/i.test(value)) return 'USD';
  return 'UNKNOWN';
}

export function appendDescription(transaction: BankTransaction, value: string): void {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean) {
    transaction.description = `${transaction.description} ${clean}`.trim();
  }
}

export function isDateLine(line: PageLine): boolean {
  return /^\d{1,2}\/(?:\d{1,2}|[A-Za-zÁÉÍÓÚáéíóú]{3})\/\d{4}\b/.test(line.text.trim());
}

export function extractLabeledValue(text: string, label: RegExp, stop?: RegExp): string {
  const match = text.match(label);
  if (!match?.[1]) return '';
  const value = match[1].trim();
  return stop ? (value.split(stop)[0]?.trim() ?? '') : value;
}

export function transactionConfidence(transaction: BankTransaction): string {
  let score = 0.65;
  if (transaction.transactionDate) score += 0.1;
  if (transaction.description) score += 0.1;
  if (transaction.amount && transaction.balance) score += 0.1;
  if (transaction.transactionTime) score += 0.05;
  return Math.min(score, 1).toFixed(2);
}

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
