import type { PageLine, StatementMetadata, TextToken } from '../../domain/models';
import { normalizeNumeric } from './amounts';

export const MONTHS: Readonly<Record<string, string>> = {
  ene: '01',
  feb: '02',
  mar: '03',
  abr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  ago: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dic: '12',
  enero: '01',
  febrero: '02',
  marzo: '03',
  abril: '04',
  mayo: '05',
  junio: '06',
  julio: '07',
  agosto: '08',
  septiembre: '09',
  octubre: '10',
  noviembre: '11',
  diciembre: '12',
};

export const EMPTY_METADATA: StatementMetadata = {
  institutionCode: '',
  institutionName: '',
  accountNumber: '',
  accountCurrency: 'UNKNOWN',
  accountHolder: '',
  periodStart: '',
  periodEnd: '',
  openingBalance: '',
  closingBalance: '',
};

/**
 * Extrae un saldo rotulado del texto de cabecera y lo normaliza.
 *
 * Devuelve cadena vacía si el rótulo no aparece o si el valor que lo sigue no
 * es un decimal bien formado: un saldo inventado sería peor que su ausencia,
 * porque invalidaría en silencio la comprobación de cuadre que habilita.
 */
export function labeledBalance(text: string, label: RegExp): string {
  const raw = text.match(label)?.[1];
  return raw ? normalizeNumeric(raw) : '';
}

export function textInRange(line: PageLine, startRatio: number, endRatio: number): string {
  return line.tokens
    .filter((token) => {
      const ratio = token.x / line.pageWidth;
      return ratio >= startRatio && ratio < endRatio;
    })
    .map((token) => token.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokensInRange(line: PageLine, startRatio: number, endRatio: number): TextToken[] {
  return line.tokens.filter((token) => {
    const ratio = token.x / line.pageWidth;
    return ratio >= startRatio && ratio < endRatio;
  });
}
