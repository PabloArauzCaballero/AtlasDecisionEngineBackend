import { Injectable } from '@nestjs/common';
import type { BankTransaction, ExtractedPdf, PageLine, ParsedStatement } from '../domain/models';
import type { StatementParser } from '../domain/statement-parser';
import {
  appendDescription,
  currencyFromText,
  isDateLine,
  labeledBalance,
  monthPeriod,
  normalizeNumeric,
  splitAmount,
  textInRange,
  toIsoDate,
  transactionConfidence,
} from './parser-helpers';

/**
 * Títulos con los que este formato anuncia su sección de resumen, después de la
 * última fila de la tabla.
 *
 * Sin ellos, todo lo que sigue —«Resumen de Saldos», «Principales Movimientos»
 * y las recomendaciones— se anexaba al último movimiento como si fuera su
 * continuación: en un extracto real eso convirtió una descripción de 14
 * caracteres en una de 160, y un canal en uno de 703. El dato no se corrompía
 * de forma visible (el importe y el saldo seguían siendo correctos), pero el
 * movimiento salía con texto ajeno que además arrastraba una decena de importes
 * del resumen, y cualquier consumidor que analizara la glosa quedaba envenenado.
 */
const END_OF_TABLE =
  /Resumen\s+de\s+Saldos|Principales\s+Movimientos|Variaci[oó]n\s+de\s+Saldos|Observaciones\s+y\s+Recomendaciones/i;

/**
 * Ninguna continuación legítima de este formato tiene texto a la izquierda de la
 * columna de descripción: verificado sobre un extracto real de 112 movimientos,
 * donde las 22 continuaciones cumplen la regla sin excepción. Una línea que sí
 * lo tiene pertenece a otra sección, aunque no la haya anunciado un título.
 */
const DESCRIPTION_COLUMN_START = 0.24;

@Injectable()
export class BcpStatementParser implements StatementParser {
  readonly institutionCode = 'BCR';
  readonly formatId = 'bcp-cuenta-mes-v1';

  supports(pdf: ExtractedPdf): boolean {
    return (
      /Extracto\s+de\s+Cuenta\s+por\s+Mes/i.test(pdf.text) &&
      /Nro\.?\s*Cuenta/i.test(pdf.text) &&
      /Medio\s+de\s+Atenci[oó]n/i.test(pdf.text)
    );
  }

  parse(pdf: ExtractedPdf): ParsedStatement {
    const transactions: BankTransaction[] = [];
    let current: BankTransaction | undefined;

    for (const line of pdf.lines) {
      if (END_OF_TABLE.test(line.text)) break;
      if (isDateLine(line)) {
        current = this.parseTransactionLine(line);
        if (current) transactions.push(current);
        continue;
      }
      if (current) this.appendContinuation(current, line);
    }
    transactions.forEach((item) => {
      item.extractionConfidence = transactionConfidence(item);
    });

    const header = pdf.lines
      .slice(0, 25)
      .map((line) => line.text)
      .join('\n');
    const periodValue = header.match(/Periodo:\s*([A-Za-zÁÉÍÓÚáéíóú]+\s+\d{4})/i)?.[1] ?? '';
    const period = monthPeriod(periodValue);
    return {
      metadata: {
        institutionCode: this.institutionCode,
        institutionName: 'Banco de Crédito de Bolivia S.A. (BCP)',
        accountNumber: header.match(/Nro\.?\s*Cuenta:\s*([\d-]+)/i)?.[1] ?? '',
        accountCurrency: currencyFromText(header),
        accountHolder:
          header.match(/Cliente:\s*(.+?)(?:Moneda:|Saldo Inicial:|$)/i)?.[1]?.trim() ?? '',
        periodStart: period.start,
        periodEnd: period.end,
        openingBalance: labeledBalance(header, /Saldo\s+Inicial:\s*([\d.,-]+)/i),
        closingBalance: labeledBalance(header, /Saldo\s+Final:\s*([\d.,-]+)/i),
      },
      transactions,
    };
  }

  private parseTransactionLine(line: PageLine): BankTransaction | undefined {
    const date = line.text.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\b/)?.[1];
    const time = line.tokens.find((token) => /^\d{2}:\d{2}:\d{2}$/.test(token.text))?.text ?? '';
    const values = line.tokens
      .filter((token) => token.x / line.pageWidth >= 0.78)
      .map((token) => normalizeNumeric(token.text))
      .filter(Boolean);
    if (!date || values.length < 2) return undefined;
    const amount = values.at(-2) ?? '';

    return {
      transactionDate: toIsoDate(date),
      transactionTime: time,
      transactionId: '',
      description: textInRange(line, 0.24, 0.43),
      channel: textInRange(line, 0.43, 0.61),
      location: textInRange(line, 0.61, 0.78),
      ...splitAmount(amount),
      balance: values.at(-1) ?? '',
      sourcePage: line.page,
      extractionConfidence: '',
    };
  }

  private appendContinuation(transaction: BankTransaction, line: PageLine): void {
    if (/P[ÁA]GINA\s+\d+\s+DE\s+\d+|Fecha\s+Hora\s+Descripci[oó]n/i.test(line.text)) {
      return;
    }
    // Segunda barrera, estructural: cubre una sección de resumen cuyo título
    // este formato cambie o traduzca. Ver DESCRIPTION_COLUMN_START.
    const hasTextLeftOfTable = line.tokens.some(
      (token) => token.x / line.pageWidth < DESCRIPTION_COLUMN_START,
    );
    if (hasTextLeftOfTable) return;
    appendDescription(transaction, textInRange(line, 0.24, 0.43));
    const channel = textInRange(line, 0.43, 0.61);
    const location = textInRange(line, 0.61, 0.78);
    if (channel) transaction.channel = `${transaction.channel} ${channel}`.trim();
    if (location) transaction.location = `${transaction.location} ${location}`.trim();
  }
}
