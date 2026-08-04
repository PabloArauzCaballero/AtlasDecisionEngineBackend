import { Injectable } from '@nestjs/common';
import type { BankTransaction, ExtractedPdf, PageLine, ParsedStatement } from '../domain/models';
import type { StatementParser } from '../domain/statement-parser';
import {
  appendDescription,
  currencyFromText,
  normalizeLabeledAmount,
  splitAmount,
  textInRange,
  toIsoDate,
  transactionConfidence,
  transactionDateRange,
} from './parser-helpers';

const ENTITY = /bancosol\.com\.bo|Fonosol/i;
const STATEMENT_TITLE = /Extracto\s+de\s+Caja\s+de\s+Ahorros/i;
const TABLE_HEADER =
  /Fecha\s+y\s+hora\s+Descripci[oó]n\s+de\s+la\s+transacci[oó]n\s+Monto\s+Saldo/i;

/** `DD-MM-YYYY`: la fecha abre la fila y la hora va en el renglón siguiente. */
const ANCHOR_DATE = /^(\d{1,2}-\d{1,2}-\d{4})\b/;
const TIME = /^\d{1,2}:\d{2}(?::\d{2})?$/;

/**
 * Pie de página. Cae dentro de la banda de la descripción, así que sin este
 * corte el último movimiento absorbería la dirección web del banco.
 */
const PAGE_FOOTER = /Fonosol|bancosol\.com\.bo|Esta entidad es supervisada/i;

const DATE_RANGE = { start: 0.06, end: 0.24 } as const;
const DESCRIPTION_RANGE = { start: 0.24, end: 0.62 } as const;
const AMOUNT_RANGE = { start: 0.62, end: 0.78 } as const;
const BALANCE_COLUMN_START = 0.78;

/**
 * «Extracto de Caja de Ahorros» de BancoSol.
 *
 * Comparte título con el del Banco Económico, así que la entidad y la cabecera
 * de la tabla son las que lo distinguen; ninguna de las dos marcas por separado
 * bastaría.
 *
 * Dos rasgos propios:
 *
 * 1. **El importe viaja con su divisa en la misma ficha de texto** —`-Bs 50.00`,
 *    `+Bs 50.00`— y el signo es un prefijo, no un paréntesis ni una columna
 *    aparte. Lo normaliza `normalizeLabeledAmount()`.
 * 2. **La hora no está en la línea de la fecha**, sino en el renglón siguiente y
 *    en su misma columna. Se recoge de la primera continuación que tenga forma
 *    de hora, sin tocar la descripción, que ocupa otra banda.
 *
 * Los movimientos se imprimen del más reciente al más antiguo; el analizador
 * conserva ese orden y es `reconcileRunningBalance()` quien lo tiene en cuenta.
 */
@Injectable()
export class BancoSolStatementParser implements StatementParser {
  readonly institutionCode = 'BSO';
  readonly formatId = 'bancosol-caja-ahorros-v1';

  supports(pdf: ExtractedPdf): boolean {
    return ENTITY.test(pdf.text) && STATEMENT_TITLE.test(pdf.text) && TABLE_HEADER.test(pdf.text);
  }

  parse(pdf: ExtractedPdf): ParsedStatement {
    const transactions: BankTransaction[] = [];
    let current: BankTransaction | undefined;

    for (const line of pdf.lines) {
      if (ANCHOR_DATE.test(line.text.trim())) {
        current = this.parseTransactionLine(line);
        if (current) transactions.push(current);
        continue;
      }
      if (!current || PAGE_FOOTER.test(line.text)) continue;
      this.appendContinuation(current, line);
    }

    transactions.forEach((item) => {
      item.extractionConfidence = transactionConfidence(item);
    });

    const header = pdf.lines
      .filter((line) => line.page === 1)
      .slice(0, 12)
      .map((line) => line.text)
      .join('\n');
    const period = transactionDateRange(transactions);

    return {
      metadata: {
        institutionCode: this.institutionCode,
        institutionName: 'Banco Solidario S.A.',
        accountNumber: header.match(/Cuenta:\s*([\d-]+)/i)?.[1] ?? '',
        accountCurrency: currencyFromText(header),
        accountHolder:
          header.match(/Titular:\s*(.+?)(?:Cuenta:|Estado:|Producto:|$)/i)?.[1]?.trim() ?? '',
        // El documento fecha su emisión, no un período: el rango sale de los
        // movimientos leídos.
        periodStart: period.start,
        periodEnd: period.end,
        // Este formato no publica saldos de apertura ni de cierre; el saldo por
        // movimiento sí está, y con él encadena la conciliación.
        openingBalance: '',
        closingBalance: '',
      },
      transactions,
    };
  }

  private parseTransactionLine(line: PageLine): BankTransaction | undefined {
    const date = line.text.trim().match(ANCHOR_DATE)?.[1];
    const amount = this.labeledValue(line, AMOUNT_RANGE.start, AMOUNT_RANGE.end);
    const balance = this.labeledValue(line, BALANCE_COLUMN_START, 1);
    if (!date || !amount) return undefined;

    return {
      transactionDate: toIsoDate(date),
      transactionTime: '',
      // El formato no publica número de comprobante.
      transactionId: '',
      description: textInRange(line, DESCRIPTION_RANGE.start, DESCRIPTION_RANGE.end),
      channel: '',
      location: '',
      ...splitAmount(amount),
      balance,
      sourcePage: line.page,
      extractionConfidence: '',
    };
  }

  /**
   * Toma el **último** valor con divisa del intervalo: si el generador partiera
   * la ficha, el importe quedaría a la derecha de su rótulo.
   */
  private labeledValue(line: PageLine, start: number, end: number): string {
    const values = line.tokens
      .filter((token) => {
        const ratio = token.x / line.pageWidth;
        return ratio >= start && ratio < end;
      })
      .map((token) => normalizeLabeledAmount(token.text))
      .filter(Boolean);
    return values.at(-1) ?? '';
  }

  private appendContinuation(transaction: BankTransaction, line: PageLine): void {
    if (!transaction.transactionTime) {
      const time = textInRange(line, DATE_RANGE.start, DATE_RANGE.end);
      if (TIME.test(time)) transaction.transactionTime = time;
    }
    appendDescription(
      transaction,
      textInRange(line, DESCRIPTION_RANGE.start, DESCRIPTION_RANGE.end),
    );
  }
}
