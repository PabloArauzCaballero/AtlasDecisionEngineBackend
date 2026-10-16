import type { BankTransaction, CurrencyCode, PageLine } from '../../domain/models';

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
