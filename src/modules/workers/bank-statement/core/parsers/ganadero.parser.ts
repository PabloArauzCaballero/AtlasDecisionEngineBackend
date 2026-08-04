import { Injectable } from '@nestjs/common';
import type { BankTransaction, ExtractedPdf, PageLine, ParsedStatement } from '../domain/models';
import type { StatementParser } from '../domain/statement-parser';
import {
  appendDescription,
  currencyFromText,
  isDateLine,
  labeledBalance,
  normalizeNumeric,
  textInRange,
  toIsoDate,
  transactionConfidence,
} from './parser-helpers';

@Injectable()
export class GanaderoStatementParser implements StatementParser {
  readonly institutionCode = 'BGA';
  readonly formatId = 'ganadero-ganamovil-v1';

  supports(pdf: ExtractedPdf): boolean {
    return (
      /BANCO\s+GANADERO/i.test(pdf.text) &&
      /GANAM[OÓ]VIL/i.test(pdf.text) &&
      /D[ÉE]BITO\s+CR[ÉE]DITO\s+SALDO/i.test(pdf.text)
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
        appendDescription(current, textInRange(line, 0.4, 0.72));
      }
    }
    transactions.forEach((item) => {
      item.extractionConfidence = transactionConfidence(item);
    });

    const accountLine = this.findLine(pdf, /NRO\.?\s*DE\s*CUENTA/i);
    const clientLine = this.findLine(pdf, /CLIENTE\s*:/i);
    const periodLine = this.findLine(pdf, /DEL\s+\d{1,2}\/\d{1,2}\/\d{4}\s+AL/i);
    const period = periodLine?.text.match(
      /DEL\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+AL\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    );

    return {
      metadata: {
        institutionCode: this.institutionCode,
        institutionName: 'Banco Ganadero S.A.',
        accountNumber: accountLine?.text.match(/CUENTA\s*:\s*([\d-]+)/i)?.[1] ?? '',
        accountCurrency: currencyFromText(pdf.text),
        accountHolder:
          clientLine?.text.match(/CLIENTE\s*:\s*(.+?)(?:Procesado|Banco|$)/i)?.[1]?.trim() ?? '',
        periodStart: period?.[1] ? toIsoDate(period[1]) : '',
        periodEnd: period?.[2] ? toIsoDate(period[2]) : '',
        // Este formato rotula el saldo de apertura como «anterior» y el de
        // cierre como «actual».
        openingBalance: labeledBalance(pdf.text, /SALDO\s+ANTERIOR\s*:?\s*([\d.,-]+)/i),
        closingBalance: labeledBalance(pdf.text, /SALDO\s+ACTUAL\s*:?\s*([\d.,-]+)/i),
      },
      transactions,
    };
  }

  private parseTransactionLine(line: PageLine): BankTransaction | undefined {
    const date = line.text.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\b/)?.[1];
    const time = line.tokens.find((token) => /^\d{2}:\d{2}:\d{2}$/.test(token.text))?.text ?? '';
    const values = line.tokens
      .filter((token) => token.x / line.pageWidth >= 0.69)
      .map((token) => normalizeNumeric(token.text))
      .filter(Boolean);
    if (!date || values.length < 3) return undefined;

    const debitSigned = Number(values.at(-3));
    const creditSigned = Number(values.at(-2));
    const debit = Math.abs(debitSigned).toFixed(2);
    const credit = Math.abs(creditSigned).toFixed(2);
    const amount = (creditSigned - Math.abs(debitSigned)).toFixed(2);

    return {
      transactionDate: toIsoDate(date),
      transactionTime: time,
      transactionId: textInRange(line, 0.3, 0.4).replace(/\s/g, ''),
      description: textInRange(line, 0.4, 0.72),
      channel: textInRange(line, 0.19, 0.3),
      location: '',
      debit: debit === '0.00' ? '' : debit,
      credit: credit === '0.00' ? '' : credit,
      amount,
      balance: values.at(-1) ?? '',
      sourcePage: line.page,
      extractionConfidence: '',
    };
  }

  private isDescriptionContinuation(line: PageLine): boolean {
    if (/P[ÁA]GINA|SALDO ACTUAL|CANTIDAD (?:D[ÉE]BITOS|CR[ÉE]DITOS)/i.test(line.text)) {
      return false;
    }
    return textInRange(line, 0.4, 0.72).length > 0;
  }

  private findLine(pdf: ExtractedPdf, pattern: RegExp): PageLine | undefined {
    return pdf.lines.find((line) => pattern.test(line.text));
  }
}
