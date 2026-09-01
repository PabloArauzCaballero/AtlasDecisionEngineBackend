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
 * Dónde empieza cada columna, MEDIDO sobre el extracto real de 112 movimientos.
 *
 * Las fichas de este formato caen siempre en las mismas cinco abscisas
 * relativas: fecha `0,0912`, hora `0,1769`, descripción `0,2398`, medio de
 * atención `0,4230` y lugar `0,6062`. Cada celda es UNA ficha, así que la
 * frontera sólo tiene que separar los PRINCIPIOS de columna, no los textos.
 *
 * Por eso cada frontera va en mitad del hueco entre dos columnas contiguas, y no
 * pegada a una de ellas. La versión anterior ponía la primera en `0,24` —dos
 * diezmilésimas por encima de la columna que quería capturar— y `textInRange`
 * compara con `>=`, así que la descripción se quedaba fuera de su propio rango
 * mientras el medio de atención, en `0,4230`, entraba dentro. La fila entera se
 * corría una columna a la izquierda: los 112 movimientos salían descritos como
 * «Tarjeta De Debito» o «Agencia» —el CANAL— en vez de «Compra Farmacorp Sc27»,
 * y el lugar se publicaba como canal.
 *
 * No se ve al leer el código ni lo delata ninguna excepción: el extracto se
 * procesa entero, con sus importes y saldos correctos, y sólo la glosa miente.
 * Aguas abajo el clasificador de gastos recibía 52 veces «Agencia» y 34 veces
 * «Tarjeta De Debito», que no nombran ningún concepto, y las mandaba al cajón de
 * «otros gastos» con toda la razón: el defecto era de esta línea.
 */
const COLUMNS = {
  description: { start: 0.21, end: 0.33 },
  channel: { start: 0.33, end: 0.51 },
  location: { start: 0.51, end: 0.78 },
} as const;

/** Dónde empieza la zona de importes: monto y saldo, las dos últimas fichas. */
const AMOUNT_ZONE_START = 0.78;

/**
 * Ninguna continuación legítima de este formato tiene texto a la izquierda de la
 * columna de descripción: verificado sobre un extracto real de 112 movimientos,
 * donde las 22 continuaciones cumplen la regla sin excepción. Una línea que sí
 * lo tiene pertenece a otra sección, aunque no la haya anunciado un título.
 *
 * Deriva de `COLUMNS` y no es un número aparte: cuando las dos se escribían por
 * separado, el mismo `0,24` de más descartaba TODAS las continuaciones —144
 * fichas en el extracto medido— porque cada una empieza justo en la columna de
 * descripción, y la referencia del movimiento («Ventaid 810717 - Banco Nacional
 * de Bolivia - …») no llegaba nunca a la glosa.
 */
const DESCRIPTION_COLUMN_START = COLUMNS.description.start;

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
      .filter((token) => token.x / line.pageWidth >= AMOUNT_ZONE_START)
      .map((token) => normalizeNumeric(token.text))
      .filter(Boolean);
    if (!date || values.length < 2) return undefined;
    const amount = values.at(-2) ?? '';

    return {
      transactionDate: toIsoDate(date),
      transactionTime: time,
      transactionId: '',
      description: textInRange(line, COLUMNS.description.start, COLUMNS.description.end),
      channel: textInRange(line, COLUMNS.channel.start, COLUMNS.channel.end),
      location: textInRange(line, COLUMNS.location.start, COLUMNS.location.end),
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
    appendDescription(
      transaction,
      textInRange(line, COLUMNS.description.start, COLUMNS.description.end),
    );
    const channel = textInRange(line, COLUMNS.channel.start, COLUMNS.channel.end);
    const location = textInRange(line, COLUMNS.location.start, COLUMNS.location.end);
    if (channel) transaction.channel = `${transaction.channel} ${channel}`.trim();
    if (location) transaction.location = `${transaction.location} ${location}`.trim();
  }
}
