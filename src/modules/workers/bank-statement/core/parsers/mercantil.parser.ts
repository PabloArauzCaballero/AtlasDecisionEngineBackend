import { Injectable } from '@nestjs/common';
import type { BankTransaction, ExtractedPdf, PageLine, ParsedStatement } from '../domain/models';
import type { StatementParser } from '../domain/statement-parser';
import {
  currencyFromText,
  normalizeNumeric,
  textInRange,
  toIsoDate,
  transactionConfidence,
} from './parser-helpers';

/**
 * Separación vertical (en puntos PDF) a partir de la cual dos renglones
 * pertenecen a filas distintas de la tabla. El extracto reparte la descripción
 * de un movimiento en varios renglones con un interlineado de ~8 pt dentro de
 * la misma celda, mientras que el salto entre filas nunca baja de ~9.1 pt.
 */
const ROW_GAP_THRESHOLD = 8.6;

const TABLE_HEADER = /FECHA\s+HORA\s+TRANSACCION/i;
const ANCHOR_DATE = /^(\d{4}\/\d{1,2}\/\d{1,2})\b/;

const DESCRIPTION_RANGE = { start: 0.18, end: 0.37 } as const;
const BRANCH_RANGE = { start: 0.37, end: 0.42 } as const;
const REFERENCE_RANGE = { start: 0.42, end: 0.6 } as const;
const AMOUNT_COLUMN_START = 0.6;

/**
 * Extracto tabular del Banco Mercantil Santa Cruz (cabecera "MAKROBANX").
 *
 * A diferencia de los otros formatos, aquí la fecha, la hora, los importes y el
 * saldo se imprimen centrados verticalmente respecto a la celda de descripción:
 * los renglones de descripción quedan tanto por encima como por debajo de la
 * línea que lleva la fecha. Por eso el parser no puede leer "línea con fecha +
 * continuaciones siguientes" como los demás; agrupa primero los renglones en
 * filas por separación vertical y recién dentro de cada fila localiza su línea
 * ancla.
 */
@Injectable()
export class MercantilStatementParser implements StatementParser {
  readonly institutionCode = 'BME';
  readonly formatId = 'mercantil-makrobanx-v1';

  supports(pdf: ExtractedPdf): boolean {
    return (
      /MAKROBANX|BANCO\s+MERCANTIL\s+SANTA\s+CRUZ|\bBMSC\b/i.test(pdf.text) &&
      TABLE_HEADER.test(pdf.text) &&
      /COD\.?\s*BCA/i.test(pdf.text)
    );
  }

  parse(pdf: ExtractedPdf): ParsedStatement {
    const transactions: BankTransaction[] = [];
    for (const row of this.groupRows(pdf.lines)) {
      const transaction = this.buildTransaction(row);
      if (transaction) transactions.push(transaction);
    }
    transactions.forEach((item) => {
      item.extractionConfidence = transactionConfidence(item);
    });

    const header = pdf.lines
      .filter((line) => line.page === 1)
      .slice(0, 20)
      .map((line) => line.text)
      .join('\n');
    const accountLine = pdf.lines.find((line) => /\bCUENTA\s+\d{5,}/i.test(line.text));

    return {
      metadata: {
        institutionCode: this.institutionCode,
        institutionName: 'Banco Mercantil Santa Cruz S.A.',
        accountNumber: header.match(/\bCUENTA\s+(\d{5,})/i)?.[1] ?? '',
        accountCurrency: currencyFromText(header),
        // El titular ocupa la mitad izquierda de la misma línea en la que el
        // recuadro derecho imprime el número de cuenta.
        accountHolder: accountLine ? textInRange(accountLine, 0, 0.5) : '',
        periodStart: toIsoDate(
          header.match(/FECHA\s+DESDE\s+(\d{4}\/\d{1,2}\/\d{1,2})/i)?.[1] ?? '',
        ),
        periodEnd: toIsoDate(header.match(/FECHA\s+HASTA\s+(\d{4}\/\d{1,2}\/\d{1,2})/i)?.[1] ?? ''),
        ...this.balances(pdf),
      },
      transactions,
    };
  }

  /**
   * Lee el bloque de totales del pie: una cabecera
   * «SALDO ANTERIOR · TOTAL DEBITOS · TOTAL CREDITOS · SALDO A LA FECHA»
   * seguida de la línea con sus cuatro valores.
   *
   * Se toman de ahí y no de los movimientos a propósito: el objetivo es que un
   * consumidor pueda contrastar la suma de importes contra un valor que el
   * banco calculó por su cuenta.
   */
  private balances(pdf: ExtractedPdf): {
    openingBalance: string;
    closingBalance: string;
  } {
    const headerIndex = pdf.lines.findIndex((line) =>
      /SALDO\s+ANTERIOR\s+TOTAL\s+DEBITOS/i.test(line.text),
    );
    const values = pdf.lines[headerIndex + 1]?.tokens
      .map((token) => normalizeNumeric(token.text))
      .filter(Boolean);

    if (headerIndex < 0 || !values || values.length < 4) {
      return { openingBalance: '', closingBalance: '' };
    }
    return {
      openingBalance: values[0] ?? '',
      closingBalance: values.at(-1) ?? '',
    };
  }

  /**
   * Reparte los renglones de la tabla en filas. Solo se consideran los que
   * están debajo de la cabecera de columnas de cada página y que aportan
   * descripción o fecha, de modo que el encabezado del extracto y el bloque de
   * totales del final quedan fuera sin necesidad de enumerarlos.
   */
  private groupRows(lines: readonly PageLine[]): PageLine[][] {
    const rows: PageLine[][] = [];
    let current: PageLine[] = [];
    let previous: PageLine | undefined;
    let insideTable = false;

    const flush = (): void => {
      if (current.length > 0) rows.push(current);
      current = [];
      previous = undefined;
    };

    for (const line of lines) {
      if (previous && line.page !== previous.page) {
        flush();
        insideTable = false;
      }
      if (TABLE_HEADER.test(line.text)) {
        flush();
        insideTable = true;
        continue;
      }
      if (!insideTable || !this.isTableLine(line)) continue;
      if (previous && previous.y - line.y > ROW_GAP_THRESHOLD) flush();
      current.push(line);
      previous = line;
    }
    flush();
    return rows;
  }

  private isTableLine(line: PageLine): boolean {
    return (
      ANCHOR_DATE.test(line.text.trim()) ||
      textInRange(line, DESCRIPTION_RANGE.start, DESCRIPTION_RANGE.end).length > 0
    );
  }

  /**
   * Una fila sin línea ancla (texto suelto del pie) o sin las tres columnas
   * numéricas —débito, crédito y saldo— no es un movimiento: así queda fuera la
   * fila "SALDO INICIAL", que solo imprime saldo.
   */
  private buildTransaction(row: PageLine[]): BankTransaction | undefined {
    const anchor = row.find((line) => ANCHOR_DATE.test(line.text.trim()));
    if (!anchor) return undefined;

    const date = anchor.text.trim().match(ANCHOR_DATE)?.[1];
    if (!date) return undefined;

    const values = anchor.tokens
      .filter((token) => token.x / anchor.pageWidth >= AMOUNT_COLUMN_START)
      .map((token) => normalizeNumeric(token.text))
      .filter(Boolean);
    if (values.length < 3) return undefined;

    const debit = Number(values.at(-3));
    const credit = Number(values.at(-2));
    const description = row
      .map((line) => textInRange(line, DESCRIPTION_RANGE.start, DESCRIPTION_RANGE.end))
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      transactionDate: toIsoDate(date),
      transactionTime:
        anchor.tokens.find((token) => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(token.text))?.text ?? '',
      transactionId: textInRange(anchor, REFERENCE_RANGE.start, REFERENCE_RANGE.end).replace(
        /\s/g,
        '',
      ),
      description,
      channel: '',
      location: textInRange(anchor, BRANCH_RANGE.start, BRANCH_RANGE.end),
      debit: debit === 0 ? '' : debit.toFixed(2),
      credit: credit === 0 ? '' : credit.toFixed(2),
      amount: (credit - debit).toFixed(2),
      balance: values.at(-1) ?? '',
      sourcePage: anchor.page,
      extractionConfidence: '',
    };
  }
}
