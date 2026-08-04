import { Injectable } from '@nestjs/common';
import type { BankTransaction, ExtractedPdf, PageLine, ParsedStatement } from '../domain/models';
import type { StatementParser } from '../domain/statement-parser';
import {
  appendDescription,
  currencyFromText,
  isDateLine,
  labeledBalance,
  normalizeNumeric,
  splitAmount,
  textInRange,
  toIsoDate,
  transactionConfidence,
  transactionDateRange,
} from './parser-helpers';

@Injectable()
export class EconomicoStatementParser implements StatementParser {
  readonly institutionCode = 'BEC';
  readonly formatId = 'economico-caja-ahorros-v1';

  supports(pdf: ExtractedPdf): boolean {
    return (
      /baneco\.com\.bo/i.test(pdf.text) &&
      /Extracto\s+de\s+Caja\s+de\s+Ahorros/i.test(pdf.text) &&
      /Nro\s+Trn\.?\/Cheque/i.test(pdf.text)
    );
  }

  parse(pdf: ExtractedPdf): ParsedStatement {
    const transactions: BankTransaction[] = [];
    let current: BankTransaction | undefined;

    for (const line of pdf.lines) {
      if (isDateLine(line)) {
        current = this.parseTransactionLine(line);
        if (current) transactions.push(current);
        continue;
      }
      if (current && this.isDescriptionContinuation(line)) {
        appendDescription(current, textInRange(line, 0.35, 0.79));
      }
    }
    transactions.forEach((item) => {
      item.extractionConfidence = transactionConfidence(item);
    });

    const header = pdf.lines
      .slice(0, 30)
      .map((line) => line.text)
      .join('\n');
    const period = header.match(
      /Del\s+(\d{1,2}\/[A-Za-zÁÉÍÓÚáéíóú]{3}\/\d{4})\s+al\s+(\d{1,2}\s*\/[A-Za-zÁÉÍÓÚáéíóú]{3}\/\d{4})/i,
    );
    const observedRange = transactionDateRange(transactions);
    return {
      metadata: {
        institutionCode: this.institutionCode,
        institutionName: 'Banco Económico S.A.',
        accountNumber: header.match(/Cuenta:\s+(?:CA:\s*)?([\d-]+)/i)?.[1] ?? '',
        accountCurrency: currencyFromText(header),
        accountHolder:
          header.match(/Titular:\s+(.+?)(?:Cuenta:|Otros titulares:|$)/i)?.[1]?.trim() ?? '',
        periodStart: period?.[1] ? toIsoDate(period[1].replace(/\s/g, '')) : observedRange.start,
        periodEnd: period?.[2] ? toIsoDate(period[2].replace(/\s/g, '')) : observedRange.end,
        // El bloque de cierre, al pie de la última página, los publica con su
        // rótulo. Se leen de ahí y no de los movimientos: derivarlos daría una
        // comprobación de cuadre que nunca podría fallar.
        openingBalance: labeledBalance(pdf.text, /Saldo\s+Inicial\s+(-?[\d,]+\.\d{2})/i),
        closingBalance: labeledBalance(pdf.text, /Saldo\s+Final\s+(-?[\d,]+\.\d{2})/i),
      },
      transactions,
    };
  }

  private parseTransactionLine(line: PageLine): BankTransaction | undefined {
    const date = line.text.match(/^(\d{1,2}\/[A-Za-zÁÉÍÓÚáéíóú]{3}\/\d{4})\b/i)?.[1];
    const time = line.tokens.find((token) => /^\d{2}:\d{2}:\d{2}$/.test(token.text))?.text ?? '';
    const values = line.tokens
      .filter((token) => token.x / line.pageWidth >= 0.79)
      .map((token) => normalizeNumeric(token.text))
      .filter(Boolean);
    if (!date || values.length < 2) return undefined;
    const amount = values.at(-2) ?? '';

    return {
      transactionDate: toIsoDate(date),
      transactionTime: time,
      transactionId: textInRange(line, 0.25, 0.35).replace(/\s/g, ''),
      description: textInRange(line, 0.35, 0.79),
      channel: '',
      location: '',
      ...splitAmount(amount),
      balance: values.at(-1) ?? '',
      sourcePage: line.page,
      extractionConfidence: '',
    };
  }

  private isDescriptionContinuation(line: PageLine): boolean {
    if (/www\.baneco|Esta entidad|Santa Cruz:|Fecha\s+Hora|Nro\s+Trn/i.test(line.text)) {
      return false;
    }
    return textInRange(line, 0.35, 0.79).length > 0;
  }
}
