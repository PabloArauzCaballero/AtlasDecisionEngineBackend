import { Injectable } from '@nestjs/common';
import type { BankTransaction, ExtractedPdf, PageLine, ParsedStatement } from '../domain/models';
import type { StatementParser } from '../domain/statement-parser';
import {
  appendDescription,
  currencyFromText,
  isDateLine,
  normalizeNumeric,
  splitAmount,
  textInRange,
  toIsoDate,
  transactionConfidence,
  transactionDateRange,
} from './parser-helpers';

const STATEMENT_TITLE = /Extracto\s+de\s+Movimientos/i;
const TABLE_HEADER = /Fecha\s+AG\s+Descripci[oó]n\s+Nro\s+Documento\s+Monto/i;

/**
 * Recuadro de saldos del pie. Sirve para dos cosas: cierra la tabla y aporta el
 * único saldo que el formato imprime.
 */
const BALANCE_HEADER = /Tr[aá]nsito\s+Consultado\s+Congelado\s+Sobregirado\s+Disponible\s+Total/i;

/** Los totales impresos marcan el final de la tabla. */
const TOTALS = /^Total\s+(?:Cr[eé]ditos|D[eé]bitos)\s*:/i;

const BRANCH_RANGE = { start: 0.13, end: 0.2 } as const;
const DESCRIPTION_RANGE = { start: 0.2, end: 0.64 } as const;
const DOCUMENT_RANGE = { start: 0.64, end: 0.8 } as const;
const AMOUNT_COLUMN_START = 0.8;

/** Columnas del recuadro de saldos; la última es el saldo total de la cuenta. */
const BALANCE_COLUMNS = 6;

/**
 * «Extracto de Movimientos» del Banco Unión: una línea por movimiento, con la
 * glosa centrada en su celda y el importe en una sola columna firmada.
 *
 * Dos rasgos condicionan todo lo demás:
 *
 * 1. **La entidad no aparece en la capa de texto.** El nombre del banco está
 *    únicamente dentro del logotipo, que es una imagen, así que `supports()` no
 *    puede exigirlo: se apoya en el título, en la cabecera de la tabla y en el
 *    recuadro de saldos del pie, tres marcas simultáneas que ningún otro
 *    formato del registro imprime.
 * 2. **No hay saldo por movimiento ni período impreso.** El extracto se pide
 *    por cantidad de movimientos («Ultimos 12 Movimientos»), no por fechas. El
 *    saldo de cada fila queda vacío —no se deriva, porque un saldo calculado
 *    convertiría la comprobación de continuidad en una tautología— y el período
 *    se toma del rango de los movimientos leídos.
 */
@Injectable()
export class UnionStatementParser implements StatementParser {
  readonly institutionCode = 'BUN';
  readonly formatId = 'union-extracto-movimientos-v1';

  supports(pdf: ExtractedPdf): boolean {
    return (
      STATEMENT_TITLE.test(pdf.text) && TABLE_HEADER.test(pdf.text) && BALANCE_HEADER.test(pdf.text)
    );
  }

  parse(pdf: ExtractedPdf): ParsedStatement {
    const transactions: BankTransaction[] = [];
    let current: BankTransaction | undefined;
    let insideTable = false;

    for (const line of pdf.lines) {
      if (TABLE_HEADER.test(line.text)) {
        insideTable = true;
        continue;
      }
      if (TOTALS.test(line.text.trim()) || BALANCE_HEADER.test(line.text)) {
        insideTable = false;
        current = undefined;
        continue;
      }
      if (!insideTable) continue;

      if (isDateLine(line)) {
        current = this.parseTransactionLine(line);
        if (current) transactions.push(current);
        continue;
      }
      // Una glosa que no cupo en su celda continúa en el renglón siguiente. Solo
      // se admite dentro de la tabla: fuera de ella, el pie del extracto cae en
      // la misma banda de coordenadas que la descripción.
      if (current) {
        appendDescription(
          current,
          textInRange(line, DESCRIPTION_RANGE.start, DESCRIPTION_RANGE.end),
        );
      }
    }

    transactions.forEach((item) => {
      item.extractionConfidence = transactionConfidence(item);
    });

    const header = pdf.lines
      .filter((line) => line.page === 1)
      .slice(0, 10)
      .map((line) => line.text)
      .join('\n');
    const period = transactionDateRange(transactions);

    return {
      metadata: {
        institutionCode: this.institutionCode,
        institutionName: 'Banco Unión S.A.',
        accountNumber: header.match(/Cuenta:\s*([\d-]+)/i)?.[1] ?? '',
        accountCurrency: currencyFromText(header),
        accountHolder: this.accountHolder(pdf),
        periodStart: period.start,
        periodEnd: period.end,
        // El formato no imprime saldo de apertura: el extracto son los últimos
        // N movimientos, no un período cerrado.
        openingBalance: '',
        closingBalance: this.closingBalance(pdf),
      },
      transactions,
    };
  }

  /**
   * El titular es el renglón inmediatamente anterior al rótulo `Cuenta:`. Se
   * localiza por posición y no por rótulo porque el formato no lo etiqueta.
   */
  private accountHolder(pdf: ExtractedPdf): string {
    const accountIndex = pdf.lines.findIndex((line) => /^Cuenta:/i.test(line.text.trim()));
    if (accountIndex < 1) return '';
    return pdf.lines[accountIndex - 1]?.text.trim() ?? '';
  }

  /**
   * Saldo total de la cuenta, última columna del recuadro del pie.
   *
   * Se exigen las seis columnas del recuadro: si el banco cambiara el bloque,
   * leer «la última cifra» de una línea distinta emitiría un saldo equivocado,
   * y una cadena vacía es preferible a un saldo inventado.
   */
  private closingBalance(pdf: ExtractedPdf): string {
    const headerIndex = pdf.lines.findIndex((line) => BALANCE_HEADER.test(line.text));
    if (headerIndex < 0) return '';
    const values = pdf.lines[headerIndex + 1]?.tokens
      .map((token) => normalizeNumeric(token.text))
      .filter(Boolean);
    if (!values || values.length < BALANCE_COLUMNS) return '';
    return values.at(-1) ?? '';
  }

  private parseTransactionLine(line: PageLine): BankTransaction | undefined {
    const date = line.text.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\b/)?.[1];
    const values = line.tokens
      .filter((token) => token.x / line.pageWidth >= AMOUNT_COLUMN_START)
      .map((token) => normalizeNumeric(token.text))
      .filter(Boolean);
    if (!date || values.length === 0) return undefined;

    return {
      transactionDate: toIsoDate(date),
      transactionTime: '',
      transactionId: textInRange(line, DOCUMENT_RANGE.start, DOCUMENT_RANGE.end).replace(/\s/g, ''),
      description: textInRange(line, DESCRIPTION_RANGE.start, DESCRIPTION_RANGE.end),
      channel: '',
      location: textInRange(line, BRANCH_RANGE.start, BRANCH_RANGE.end),
      ...splitAmount(values.at(-1) ?? ''),
      // El formato no imprime saldo por movimiento.
      balance: '',
      sourcePage: line.page,
      extractionConfidence: '',
    };
  }
}
