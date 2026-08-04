import { Injectable } from '@nestjs/common';
import type { BankTransaction, ExtractedPdf, PageLine, ParsedStatement } from '../domain/models';
import type { StatementParser } from '../domain/statement-parser';
import {
  currencyFromText,
  extractLabeledValue,
  normalizeNumeric,
  splitAmount,
  textInRange,
  tokensInRange,
  toIsoDate,
  transactionConfidence,
} from './parser-helpers';

/**
 * Sección del extracto a la que pertenece una fila.
 *
 * Es el único dato que fija el signo del movimiento: este formato no imprime
 * una columna de débito y otra de crédito, sino **dos tablas separadas** con una
 * sola columna de importe cada una, siempre en positivo. Leer el signo de la
 * cifra sería imposible; se lee de la tabla que la contiene.
 */
type Section = 'DEPOSITS' | 'WITHDRAWALS';

const DEPOSITS_HEADING = /^Dep[oó]sitos$/i;
const WITHDRAWALS_HEADING = /^Retiros$/i;
const TABLE_HEADER = /Fecha\s+Hora\s*Descripci[oó]n/i;
const END_OF_SECTION = /^Total\s+(?:dep[oó]sitos|retiros)\b/i;

const DATE = /(?<!\d)(\d{2}\/\d{2}\/\d{4})(?!\d)/;

/**
 * La hora no puede exigir un límite de palabra por la derecha: cuando el
 * movimiento cabe en un renglón, el generador pega la glosa a la hora dentro de
 * la misma ficha —`23:59PAGO DE INTERES`— y un `\b` no encuentra frontera entre
 * `9` y `P`.
 */
const TIME = /(?<!\d)(\d{1,2}:\d{2})(?!\d)/;

/**
 * Comprobante de la operación, al final de la ficha que lo contiene.
 *
 * Se reconoce por su forma y no por su columna, por dos razones medidas sobre
 * el extracto real: el generador une la referencia y el comprobante en una sola
 * ficha cuando quedan pegados —`61536391332P68253061` es «6153639133» seguido
 * de «2P68253061»—, y cuando van separados el comprobante cae en una
 * coordenada distinta en cada tabla. Buscarlo por forma cubre los dos casos:
 * las **102** operaciones llevan una y sólo una ficha que termina en `2P` más
 * ocho alfanuméricos, y ninguna otra ficha a la derecha de la glosa la imita.
 */
const VOUCHER = /(2P[A-Z0-9]{8})$/;

/**
 * Canal de la operación: lo que sigue al primer « - » de la glosa, hasta el
 * primer campo rotulado. Los seis tipos de operación del extracto medido lo
 * imprimen así, con tres valores distintos: `BNB NET`, `ATM/POS` y la agencia
 * que registró el asiento.
 */
const OPERATION_CHANNEL =
  /^[^]*?\s-\s([^]*?)(?=\s+(?:Cuenta\s+(?:Origen|Destino):|Lugar:|Nombre:|Dato\s+Adicional:)|$)/;

/**
 * Separación vertical a partir de la cual dos renglones son filas distintas.
 *
 * Medido con `yarn inspect:gaps` sobre el extracto real: dentro de una fila el
 * interlineado es de 3,8 pt (tabla de retiros) o 7,6 pt (tabla de depósitos), y
 * el salto entre filas nunca baja de 8,7 pt. Con este umbral los 102
 * movimientos quedan en 102 grupos de una sola ancla y ninguno fusionado.
 */
const ROW_GAP_THRESHOLD = 8.2;

/**
 * Borde izquierdo de la columna de descripción, distinto en cada tabla: la de
 * depósitos necesita más ancho para las columnas de la derecha y desplaza la
 * glosa.
 */
const DESCRIPTION_START: Readonly<Record<Section, number>> = {
  DEPOSITS: 0.14,
  WITHDRAWALS: 0.11,
};

/** Borde izquierdo de la celda de referencia y comprobante, por tabla. */
const REFERENCE_START: Readonly<Record<Section, number>> = {
  DEPOSITS: 0.68,
  WITHDRAWALS: 0.74,
};

/**
 * Zona a la derecha de la referencia. El importe es la **última** ficha
 * numérica que cae en ella, no la primera: entre ambas puede aparecer el ITF,
 * que este formato imprime en su propia columna intermedia.
 */
const AMOUNT_ZONE_START = 0.8;

/**
 * Extracto «Tu Banca Personal» del Banco Nacional de Bolivia.
 *
 * Dos rasgos lo separan de los demás formatos admitidos:
 *
 * 1. **Dos tablas, un importe por fila.** Los abonos van en «Depósitos» y los
 *    cargos en «Retiros», ambos en positivo. El signo lo pone la sección.
 * 2. **La fecha no ancla la fila.** El generador centra la fecha y la hora
 *    respecto de la celda de glosa y las parte en dos renglones cuando la
 *    descripción ocupa tres, de modo que hay renglones de texto por encima, por
 *    debajo y **entre** la fecha y su hora. Como el de Mercantil, agrupa por
 *    separación vertical y recién dentro de cada grupo localiza sus campos.
 *
 * Este formato no imprime saldo corriente por movimiento, así que `balance`
 * queda vacío en todas las filas. El cuadre se hace contra los saldos de la
 * carátula, que sí publica.
 */
@Injectable()
export class BnbStatementParser implements StatementParser {
  readonly institutionCode = 'BNB';
  readonly formatId = 'bnb-banca-personal-v1';

  supports(pdf: ExtractedPdf): boolean {
    return (
      /BANCO\s+NACIONAL\s+DE\s+BOLIVIA|bnb\.com\.bo/i.test(pdf.text) &&
      /Tu\s+Banca\s+Personal/i.test(pdf.text) &&
      /Total\s+(?:dep[oó]sitos|retiros)/i.test(pdf.text)
    );
  }

  parse(pdf: ExtractedPdf): ParsedStatement {
    const transactions: BankTransaction[] = [];
    for (const { section, lines } of this.groupRows(pdf.lines)) {
      const transaction = this.buildTransaction(section, lines);
      if (transaction) transactions.push(transaction);
    }
    transactions.forEach((item) => {
      item.extractionConfidence = transactionConfidence(item);
    });

    const header = pdf.lines
      .filter((line) => line.page === 1)
      .map((line) => line.text)
      .join('\n');
    const period = header.match(
      /del\s+(\d{1,2}\s+de\s+[A-Za-zÁÉÍÓÚáéíóú]+,?\s+\d{4})\s+al\s+(\d{1,2}\s+de\s+[A-Za-zÁÉÍÓÚáéíóú]+,?\s+\d{4})/i,
    );

    return {
      metadata: {
        institutionCode: this.institutionCode,
        institutionName: 'Banco Nacional de Bolivia S.A.',
        accountNumber: header.match(/N[uú]mero\s+de\s+cuenta:\s*([\d-]+)/i)?.[1] ?? '',
        accountCurrency: currencyFromText(header),
        accountHolder: this.accountHolder(pdf),
        periodStart: toIsoDate(period?.[1] ?? ''),
        periodEnd: toIsoDate(period?.[2] ?? ''),
        ...this.balances(pdf),
      },
      transactions,
    };
  }

  /**
   * Toma el titular de la línea que lo imprime junto al número de cuenta, en la
   * cabecera que se repite en cada página. La carátula lo imprime también
   * suelto, pero ahí es indistinguible de la dirección postal que le sigue.
   */
  private accountHolder(pdf: ExtractedPdf): string {
    const line = pdf.lines.find((candidate) =>
      /\|\s*N[uú]mero\s+de\s+cuenta:/i.test(candidate.text),
    );
    return line?.text.split('|')[0]?.trim() ?? '';
  }

  /**
   * Lee los dos saldos de la carátula: «Saldo al <fecha inicial>» y «Saldo al
   * <fecha final>».
   *
   * Se identifican por posición —el primero abre el período y el último lo
   * cierra— y no por su fecha, para no depender de que el rótulo repita
   * exactamente las fechas del encabezado. Si no aparecen los dos, se devuelven
   * ambos vacíos: un saldo de apertura sin el de cierre no permite el cuadre, y
   * emitir uno solo invitaría a confundirlo con el otro.
   */
  private balances(pdf: ExtractedPdf): {
    openingBalance: string;
    closingBalance: string;
  } {
    const balanceLines = pdf.lines.filter(
      (line) => line.page === 1 && /^Saldo\s+al\b/i.test(line.text),
    );
    if (balanceLines.length < 2) {
      return { openingBalance: '', closingBalance: '' };
    }
    const valueOf = (line: PageLine | undefined): string =>
      normalizeNumeric(line?.tokens.at(-1)?.text ?? '');
    return {
      openingBalance: valueOf(balanceLines[0]),
      closingBalance: valueOf(balanceLines.at(-1)),
    };
  }

  /**
   * Reparte los renglones de ambas tablas en filas, anotando cada una con la
   * sección que le da el signo.
   *
   * El encabezado de sección y el de columnas se repiten en cada página, y la
   * tabla de retiros continúa a lo largo de cuatro. Por eso el estado de sección
   * sobrevive al salto de página, pero la fila en curso no: dos renglones de
   * páginas distintas nunca pertenecen al mismo movimiento.
   */
  private groupRows(lines: readonly PageLine[]): Array<{ section: Section; lines: PageLine[] }> {
    const rows: Array<{ section: Section; lines: PageLine[] }> = [];
    let current: PageLine[] = [];
    let previous: PageLine | undefined;
    let section: Section | undefined;
    let insideTable = false;

    const flush = (): void => {
      if (current.length > 0 && section) rows.push({ section, lines: current });
      current = [];
      previous = undefined;
    };

    for (const line of lines) {
      const text = line.text.trim();
      if (previous && line.page !== previous.page) flush();
      if (DEPOSITS_HEADING.test(text)) {
        flush();
        section = 'DEPOSITS';
        insideTable = false;
        continue;
      }
      if (WITHDRAWALS_HEADING.test(text)) {
        flush();
        section = 'WITHDRAWALS';
        insideTable = false;
        continue;
      }
      if (TABLE_HEADER.test(text)) {
        flush();
        insideTable = true;
        continue;
      }
      if (END_OF_SECTION.test(text)) {
        flush();
        insideTable = false;
        continue;
      }
      if (!insideTable || !section) continue;
      if (!this.isTableLine(line, section)) continue;
      if (previous && previous.y - line.y > ROW_GAP_THRESHOLD) flush();
      current.push(line);
      previous = line;
    }
    flush();
    return rows;
  }

  /**
   * Un renglón pertenece a la tabla si aporta fecha u hora, glosa o importe.
   *
   * Las tres condiciones son necesarias: hay filas cuya fecha viaja sola en un
   * renglón y cuya hora viaja sola en otro, y descartar cualquiera de los dos
   * dejaría el movimiento sin ese campo. El pie de página, el aviso de
   * continuación y la cabecera que repite titular y cuenta no cumplen ninguna y
   * quedan fuera sin necesidad de enumerarlos.
   */
  private isTableLine(line: PageLine, section: Section): boolean {
    const dateCell = textInRange(line, 0, DESCRIPTION_START[section]);
    return (
      DATE.test(dateCell) ||
      TIME.test(dateCell) ||
      textInRange(line, DESCRIPTION_START[section], REFERENCE_START[section]).length > 0 ||
      this.amountsOf([line]).length > 0
    );
  }

  private buildTransaction(section: Section, row: PageLine[]): BankTransaction | undefined {
    const descriptionStart = DESCRIPTION_START[section];
    const dateCell = row
      .map((line) => textInRange(line, 0, descriptionStart))
      .filter(Boolean)
      .join(' ');

    const date = dateCell.match(DATE)?.[1];
    const amount = this.amountsOf(row).at(-1);
    if (!date || !amount) return undefined;

    const time = dateCell.match(TIME)?.[1] ?? '';
    const description = this.description(section, row, dateCell, date, time);

    return {
      transactionDate: toIsoDate(date),
      transactionTime: time,
      transactionId: this.voucher(section, row),
      description,
      channel: description.match(OPERATION_CHANNEL)?.[1]?.trim() ?? '',
      location: extractLabeledValue(description, /Lugar:\s*(.+)/i, /Ciudad:/i),
      ...splitAmount(section === 'WITHDRAWALS' ? `-${amount}` : amount),
      // Este formato no imprime saldo por movimiento; ver la nota de la clase.
      balance: '',
      sourcePage: row[0]?.page ?? 0,
      extractionConfidence: '',
    };
  }

  /**
   * Une la glosa de la fila y le añade lo que quede en la celda de fecha una vez
   * retiradas la fecha y la hora.
   *
   * Ese resto casi siempre está vacío, pero no siempre: cuando el movimiento
   * cabe en un solo renglón, el generador puede pegar la glosa a la hora dentro
   * de la misma ficha —`23:59PAGO DE INTERES - SCZ/AGENCIA CENTRAL`—, y sin
   * rescatarla el movimiento saldría sin descripción alguna.
   */
  private description(
    section: Section,
    row: PageLine[],
    dateCell: string,
    date: string,
    time: string,
  ): string {
    const cell = row
      .map((line) => textInRange(line, DESCRIPTION_START[section], REFERENCE_START[section]))
      .filter(Boolean)
      .join(' ');
    const glued = dateCell.replace(date, ' ').replace(time, ' ').replace(/\s+/g, ' ').trim();
    return `${glued} ${cell}`.replace(/\s+/g, ' ').trim();
  }

  /**
   * Busca el comprobante entre las fichas que quedan a la derecha de la glosa.
   * Ver `VOUCHER`: la búsqueda es por forma, ficha a ficha, y no por columna.
   */
  private voucher(section: Section, row: PageLine[]): string {
    return (
      row
        .flatMap((line) => tokensInRange(line, REFERENCE_START[section], 1))
        .map((token) => token.text.match(VOUCHER)?.[1])
        .find(Boolean) ?? ''
    );
  }

  private amountsOf(lines: readonly PageLine[]): string[] {
    return lines.flatMap((line) =>
      line.tokens
        .filter((token) => token.x / line.pageWidth >= AMOUNT_ZONE_START)
        .map((token) => normalizeNumeric(token.text))
        .filter(Boolean),
    );
  }
}
