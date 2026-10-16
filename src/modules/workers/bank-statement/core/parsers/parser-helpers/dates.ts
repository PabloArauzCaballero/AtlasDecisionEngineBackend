import { MONTHS } from './metadata-and-text';

function validIsoDate(yearText: string, monthText: string, dayText: string): string {
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysByMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    !Number.isInteger(year) ||
    year < 1 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > (daysByMonth[month - 1] ?? 0)
  ) {
    return '';
  }
  return `${yearText.padStart(4, '0')}-${monthText.padStart(2, '0')}-${dayText.padStart(2, '0')}`;
}

export function toIsoDate(value: string): string {
  const yearFirst = value.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (yearFirst) {
    return validIsoDate(yearFirst[1] ?? '', yearFirst[2] ?? '', yearFirst[3] ?? '');
  }

  const numeric = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (numeric) {
    return validIsoDate(numeric[3] ?? '', numeric[2] ?? '', numeric[1] ?? '');
  }

  // `DD-MM-YYYY`, con la que BancoSol fecha sus movimientos. El día va primero,
  // como en el resto de las formas admitidas y como lo escribe el propio banco
  // en el nombre de sus archivos (`…-20-02-2026.pdf`).
  const hyphenated = value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (hyphenated) {
    return validIsoDate(hyphenated[3] ?? '', hyphenated[2] ?? '', hyphenated[1] ?? '');
  }

  // Forma redactada, «01 de junio, 2026» o «01 de junio de 2026», con la que el
  // Banco Nacional de Bolivia rotula el período y sus saldos.
  const spelled = value
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})\s+de\s+([a-záéíóú]+),?\s+(?:de\s+)?(\d{4})$/i);
  if (spelled) {
    const month = MONTHS[spelled[2]?.normalize('NFD').replace(/\p{Diacritic}/gu, '') ?? ''];
    return month ? validIsoDate(spelled[3] ?? '', month, spelled[1] ?? '') : '';
  }

  const named = value
    .toLowerCase()
    .replace(/\./g, '')
    .match(/^(\d{1,2})\/([a-záéíóú]+)\/(\d{4})$/i);
  if (!named) {
    return '';
  }
  const month = MONTHS[named[2]?.normalize('NFD').replace(/\p{Diacritic}/gu, '') ?? ''];
  return month ? validIsoDate(named[3] ?? '', month, named[1] ?? '') : '';
}

export function monthPeriod(value: string): {
  start: string;
  end: string;
} {
  const match = value
    .trim()
    .toLowerCase()
    .match(/([a-záéíóú]+)\s+(\d{4})/i);
  if (!match) {
    return { start: '', end: '' };
  }
  const month = MONTHS[match[1]?.normalize('NFD').replace(/\p{Diacritic}/gu, '') ?? ''];
  if (!month) {
    return { start: '', end: '' };
  }
  const year = Number(match[2]);
  const monthNumber = Number(month);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate().toString().padStart(2, '0');
  return {
    start: `${year}-${month}-01`,
    end: `${year}-${month}-${lastDay}`,
  };
}
