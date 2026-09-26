import type { ExtractedPdf, PageLine, StatementMetadata } from '../../domain/models';
import { currencyFromText, monthPeriod, transactionDateRange } from '../../parsers/parser-helpers';
import type { BankTransaction } from '../../domain/models';
import { coverRegion, coverText } from '../statement-context';
import type { InstitutionDetection } from '../statement-context';
import { readLabeledCell } from './cover-reader';
import { readDate, type DateInterpretation } from './date-reader';
import { parseAmount, type NumberFormat } from './number-format';

/** Cualquier fecha con separadores, con mes en número o en letra. */
const DATE = String.raw`\d{1,4}[-/.\s][A-Za-z0-9ÁÉÍÓÚáéíóú]{1,10}[-/.\s]\d{2,4}`;
/** Importe con o sin etiqueta de divisa, signo o paréntesis. */
const AMOUNT = String.raw`\(?-?\s*(?:Bs\.?|USD|\$us|\$)?\s*[\d.,]*\d[\d.,]*\)?`;

export interface ExtractedTotals {
  readonly debit: string;
  readonly credit: string;
}

export interface GenericMetadata {
  readonly metadata: StatementMetadata;
  readonly totals: ExtractedTotals;
  /** Producto rotulado por el banco, si lo rotula. */
  readonly accountType: string;
  /** Todas las cuentas rotuladas en el documento, en orden de aparición. */
  readonly accounts: readonly string[];
  readonly warnings: readonly string[];
}

/**
 * Rótulo de cuenta con identificador NUMÉRICO —o enmascarado—, que es como lo
 * imprime un banco. Los dos puntos son opcionales porque muchos rotulan
 * `Nro. Cuenta 4010203040` sin ellos.
 */
export const ACCOUNT_LABEL =
  /(?:nro\.?\s*(?:de\s+)?cuenta|n[uú]mero\s+de\s+cuenta|cuenta|account\s*(?:number|no\.?)?)\s*:?\s*(?:[A-Z]{1,3}\s*:\s*)?([\dXx*][\dXx*-]{4,})/gi;

/**
 * La misma cuenta cuando su identificador lleva LETRAS y el rótulo trae un
 * calificador: `Cuenta de prueba: CUENTA-TEST-P01-XXXX`.
 *
 * Existe por un fallo medido. Un documento de sesenta páginas con doce cuentas
 * distintas no disparó ni una sola de las salvaguardas que hay para eso
 * —`documento-con-varias-cuentas`, la etiqueta de cuenta en cada movimiento—
 * porque el patrón de arriba exige que el valor empiece por dígito. Con cero
 * cuentas reconocidas, el motor mezcló las doce en silencio y validó 1.082
 * movimientos contra el período y los saldos de la primera: 867 fechas «fuera
 * del período» y 11 saltos de saldo que no eran errores de lectura sino las
 * once fronteras entre cuentas.
 *
 * Aquí los dos puntos son OBLIGATORIOS y el valor tiene que llevar dígito o
 * máscara. Las dos condiciones juntas son lo que separa un rótulo de una glosa:
 * «COMISION MANTENIMIENTO CUENTA | CONTABILIZADA» contiene la palabra pero no
 * cierra con dos puntos, y «Cuenta de ahorro: Bolivianos» los cierra pero no
 * nombra ninguna cuenta. Sin ellas, cada extracto con una comisión de
 * mantenimiento habría pasado por documento multicuenta.
 */
const ACCOUNT_LABEL_ALPHANUMERIC =
  /(?:n(?:ro\.?|[uú]mero)\s*(?:de\s+)?)?cuenta(?:\s+(?:de|del|para)?\s*[a-zá-úñ]+){0,2}\s*:\s*([A-Za-z][A-Za-z\d*]*(?:[-/][A-Za-z\d*]+)*)/gi;

/** Un identificador de cuenta nombra algo: lleva cifras o va enmascarado. */
const IDENTIFIES_AN_ACCOUNT = /\d|\*|X{3,}/;

/**
 * Cuentas distintas rotuladas en un texto, en orden de aparición.
 *
 * Los dos patrones se recorren juntos y el resultado se ordena por posición, no
 * por patrón: «orden de aparición» es lo que promete el contrato, y un
 * documento puede rotular unas cuentas de una forma y otras de otra.
 */
export function findAccountNumbers(text: string): string[] {
  const matches = [
    ...text.matchAll(ACCOUNT_LABEL),
    ...[...text.matchAll(ACCOUNT_LABEL_ALPHANUMERIC)].filter((match) =>
      IDENTIFIES_AN_ACCOUNT.test(match[1] ?? ''),
    ),
  ].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));

  const found: string[] = [];
  for (const match of matches) {
    const value = match[1]?.trim();
    if (value && !found.includes(value)) found.push(value);
  }
  return found;
}

/**
 * Lee la carátula del documento buscando **rótulos**, no posiciones.
 *
 * Los metadatos son el único bloque de un extracto que no está tabulado: cada
 * banco los coloca donde le conviene, pero todos los rotulan. Cada campo que no
 * aparece se emite vacío; ninguno se deduce de los movimientos, salvo el
 * período, que se marca como observado y no como declarado.
 */
export function extractGenericMetadata(
  pdf: ExtractedPdf,
  institution: InstitutionDetection,
  transactions: readonly BankTransaction[],
  numberFormat: NumberFormat,
  dateInterpretation: DateInterpretation,
): GenericMetadata {
  const cover = coverText(pdf);
  const coverLines = coverRegion(pdf);
  const whole = pdf.text;
  const warnings: string[] = [];

  const accounts = findAccountNumbers(whole);
  if (accounts.length > 1) {
    // No se mezclan en silencio: cada movimiento lleva la suya y el consumidor
    // decide si las separa.
    warnings.push(`documento-con-varias-cuentas:${accounts.length}`);
  }

  const period = readPeriod(cover, dateInterpretation);
  if (!period.start || !period.end) {
    const observed = transactionDateRange(transactions);
    if (observed.start) warnings.push('periodo-observado-no-declarado');
    period.start ||= observed.start;
    period.end ||= observed.end;
  }

  const amount = (label: RegExp, fallback: string): string =>
    readAmount(pdf.lines, whole, label, fallback, numberFormat);

  return {
    metadata: {
      institutionCode: institution.code,
      institutionName: institution.name ?? '',
      accountNumber: readAccountNumber(cover),
      accountCurrency: currencyFromText(cover),
      accountHolder: readHolder(coverLines, cover),
      periodStart: period.start,
      periodEnd: period.end,
      openingBalance: amount(
        /^saldo\s+(?:inicial|anterior|al\s+inicio)/,
        String.raw`saldo\s+(?:inicial|anterior|al\s+inicio)`,
      ),
      closingBalance: amount(
        /^saldo\s+(?:final|actual|al\s+cierre|a\s+la\s+fecha|disponible)/,
        String.raw`saldo\s+(?:final|actual|al\s+cierre|a\s+la\s+fecha|disponible)`,
      ),
    },
    accountType: readAccountType(coverLines, cover),
    accounts,
    totals: {
      debit: amount(/^total\s+(?:de\s+)?debitos?/, String.raw`total\s+(?:de\s+)?d[eé]bitos?`),
      credit: amount(/^total\s+(?:de\s+)?creditos?/, String.raw`total\s+(?:de\s+)?cr[eé]ditos?`),
    },
    warnings,
  };
}

/**
 * Importe rotulado, leído primero por geometría y solo después por texto.
 *
 * El orden importa. La lectura geométrica es la única que distingue el importe
 * que está **bajo** el rótulo del que simplemente aparece después de él en el
 * flujo de texto, y esa distinción es la que evita atribuir el saldo inicial al
 * saldo final en una carátula con tarjetas de resumen. La lectura por texto
 * queda como red: cubre las carátulas donde el rótulo y su importe no comparten
 * ni renglón ni columna.
 */
function readAmount(
  lines: readonly PageLine[],
  whole: string,
  label: RegExp,
  textLabel: string,
  numberFormat: NumberFormat,
): string {
  const cell = readLabeledCell(
    lines,
    label,
    (value) => parseAmount(value, numberFormat).value !== '',
  );
  if (cell) return parseAmount(cell, numberFormat).value;
  return readLabeledAmount(whole, textLabel, numberFormat);
}

function readPeriod(
  cover: string,
  interpretation: DateInterpretation,
): { start: string; end: string } {
  const between = new RegExp(
    String.raw`(?:del?|desde|from)\s+(${DATE})\s+(?:al?|hasta|to)\s+(${DATE})`,
    'i',
  ).exec(cover);
  if (between) {
    return {
      start: readDate(compact(between[1] ?? ''), interpretation).iso,
      end: readDate(compact(between[2] ?? ''), interpretation).iso,
    };
  }

  const labelled = new RegExp(
    String.raw`fecha\s+(?:desde|inicial)\s*:?\s*(${DATE})[\s\S]{0,80}?fecha\s+(?:hasta|final)\s*:?\s*(${DATE})`,
    'i',
  ).exec(cover);
  if (labelled) {
    return {
      start: readDate(compact(labelled[1] ?? ''), interpretation).iso,
      end: readDate(compact(labelled[2] ?? ''), interpretation).iso,
    };
  }

  // `Periodo: 01/07/2026 - 31/07/2026`. El guion como separador es tan común
  // como la preposición, y sin él el período se marcaría como deducido de los
  // movimientos aun estando impreso en la carátula.
  const dashed = new RegExp(
    String.raw`per[ií]odo\s*:?\s*(${DATE})\s*(?:[-–—]|al?|hasta|to)\s*(${DATE})`,
    'i',
  ).exec(cover);
  if (dashed) {
    return {
      start: readDate(compact(dashed[1] ?? ''), interpretation).iso,
      end: readDate(compact(dashed[2] ?? ''), interpretation).iso,
    };
  }

  const monthly = /per[ií]odo\s*:?\s*([A-Za-zÁÉÍÓÚáéíóú]+\s+\d{4})/i.exec(cover);
  if (monthly?.[1]) {
    const derived = monthPeriod(monthly[1]);
    if (derived.start) return derived;
  }

  return { start: '', end: '' };
}

/**
 * El número de cuenta admite prefijos de producto (`CA: 1234567890`), guiones y
 * enmascarado con asteriscos. Se conserva tal como lo imprime el banco: el
 * enmascarado para publicación ocurre en el modelo normalizado, no aquí.
 *
 * Es la primera que aparece en la carátula, y se lee con el MISMO reconocedor
 * que descubre si el documento trae varias. Antes eran dos patrones gemelos
 * escritos a mano, que es una forma segura de que un día dejen de coincidir:
 * bastaba ampliar uno para que el motor supiera de una cuenta que luego no
 * sabía contar.
 */
function readAccountNumber(cover: string): string {
  return findAccountNumbers(cover)[0] ?? '';
}

const ACCOUNT_TYPE_LABEL = /^(?:producto|account\s+type|tipo(?:\s+de\s+cuenta)?(?!\s*de\s+cambio))/;

function readAccountType(coverLines: readonly PageLine[], cover: string): string {
  const cell = readLabeledCell(coverLines, ACCOUNT_TYPE_LABEL, isDescriptive);
  const match =
    cell ||
    /(?:producto|tipo\s+de\s+cuenta|account\s+type)\s*:?\s*([^\n]{3,40})/i.exec(cover)?.[1] ||
    '';
  return truncateAtNextLabel(match, /\s{2,}|(?:cuenta|estado|moneda|administraci[oó]n)\s*:/i);
}

function readHolder(coverLines: readonly PageLine[], cover: string): string {
  const cell = readLabeledCell(
    coverLines,
    /^(?:titular|cliente|nombre\s+del\s+titular|account\s+holder)/,
    isDescriptive,
  );
  const match =
    cell ||
    /(?:titular|cliente|nombre\s+del\s+titular|account\s+holder)\s*:?\s*([^\n]{3,80})/i.exec(
      cover,
    )?.[1] ||
    '';
  // El rótulo siguiente marca el final del valor: en una carátula a dos
  // columnas maquetada como un solo renglón de texto, el nombre y el rótulo de
  // la derecha llegan juntos.
  return truncateAtNextLabel(
    match,
    /\s{2,}|(?:cuenta|producto|estado|moneda|sucursal|administraci[oó]n|otros\s+titulares)\s*:/i,
  );
}

/** Un valor de carátula tiene letras; un rótulo suelto o un número no sirve. */
function isDescriptive(value: string): boolean {
  return value.length >= 3 && /[a-zá-úñ]/i.test(value);
}

function truncateAtNextLabel(value: string, nextLabel: RegExp): string {
  return value.split(nextLabel)[0]?.trim().replace(/\s+/g, ' ') ?? '';
}

function readLabeledAmount(text: string, label: string, numberFormat: NumberFormat): string {
  const match = new RegExp(String.raw`${label}\s*:?\s*(${AMOUNT})`, 'i').exec(text);
  if (!match?.[1]) return '';
  return parseAmount(match[1], numberFormat).value;
}

function compact(value: string): string {
  return value.replace(/\s+/g, '');
}
