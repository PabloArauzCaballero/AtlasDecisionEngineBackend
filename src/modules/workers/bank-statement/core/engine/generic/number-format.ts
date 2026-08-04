/**
 * Convención numérica del documento.
 *
 * No se puede decidir ficha por ficha: `1.234` es mil doscientos treinta y
 * cuatro en la convención europea y uno coma doscientos treinta y cuatro en la
 * anglosajona, y las dos aparecen en extractos bolivianos según quién genere el
 * PDF. La única forma de resolverlo sin adivinar es **contar** las fichas que sí
 * son inequívocas en todo el documento y aplicar esa convención a las demás.
 */
export interface NumberFormat {
  readonly decimalSeparator: '.' | ',';
  readonly thousandSeparator: '.' | ',' | '';
  /** Cuántas fichas inequívocas respaldan la decisión. */
  readonly evidence: number;
}

/** `1.234.567,89` — separador de miles con punto y decimal con coma. */
const EUROPEAN_GROUPED = /^-?\d{1,3}(?:\.\d{3})+,\d{1,2}$/;
/** `1,234,567.89` — separador de miles con coma y decimal con punto. */
const ANGLO_GROUPED = /^-?\d{1,3}(?:,\d{3})+\.\d{1,2}$/;
/** `1234,89` — sin miles, decimal con coma. */
const PLAIN_COMMA = /^-?\d+,\d{1,2}$/;
/** `1234.89` — sin miles, decimal con punto. */
const PLAIN_DOT = /^-?\d+\.\d{1,2}$/;

/**
 * Etiquetas de divisa e indicadores de signo que acompañan al importe dentro de
 * la misma ficha de texto. Se retiran antes de interpretar el número, y el
 * indicador que aportan se devuelve aparte.
 */
const CURRENCY_LABEL = /\b(?:Bs\.?|BOB|USD)\b|US\$|\$us|\$|€|\bEUR\b/gi;
const CREDIT_SUFFIX = /(?:^|\s)(?:CR|CRE|C|H|HABER)$/i;
const DEBIT_SUFFIX = /(?:^|\s)(?:DB|DEB|D|DEBE)$/i;

export const DEFAULT_NUMBER_FORMAT: NumberFormat = {
  decimalSeparator: '.',
  thousandSeparator: ',',
  evidence: 0,
};

/**
 * Deduce la convención numérica a partir de las fichas que solo admiten una
 * lectura. Con empate o sin evidencia se conserva la anglosajona, que es la que
 * usan los siete formatos medidos.
 */
export function detectNumberFormat(samples: Iterable<string>): NumberFormat {
  let european = 0;
  let anglo = 0;
  for (const sample of samples) {
    const value = stripCurrency(sample);
    if (EUROPEAN_GROUPED.test(value)) european += 1;
    else if (ANGLO_GROUPED.test(value)) anglo += 1;
    // `1234,89` y `1234.89` solo desempatan si no hay agrupadas, porque una
    // convención puede producir ambas formas en el mismo documento.
    else if (PLAIN_COMMA.test(value)) european += 1;
    else if (PLAIN_DOT.test(value)) anglo += 1;
  }

  if (european > anglo) {
    return {
      decimalSeparator: ',',
      thousandSeparator: '.',
      evidence: european,
    };
  }
  return { ...DEFAULT_NUMBER_FORMAT, evidence: anglo };
}

export interface ParsedAmount {
  /** Valor canónico `-1234.56`, o cadena vacía si la ficha no es un importe. */
  readonly value: string;
  /** Indicador de signo que traía la propia ficha, si lo traía. */
  readonly indicator?: 'DEBIT' | 'CREDIT';
}

/**
 * Interpreta una ficha como importe según la convención del documento.
 *
 * Admite lo que aparece en extractos reales: etiqueta de divisa pegada
 * (`-Bs 50.00`), signo como prefijo o sufijo (`1.234,56-`), paréntesis para el
 * negativo (`(1,234.56)`) y sufijos `DB`/`CR`. Devuelve cadena vacía —nunca
 * cero— cuando la ficha no es un importe: un cero inventado se confundiría con
 * un movimiento real de importe nulo.
 */
export function parseAmount(
  raw: string,
  format: NumberFormat = DEFAULT_NUMBER_FORMAT,
): ParsedAmount {
  let text = raw.trim();
  if (!text) return { value: '' };

  let indicator: ParsedAmount['indicator'];
  let negative = false;

  const parenthesized = /^\((.*)\)$/.exec(text);
  if (parenthesized?.[1] !== undefined) {
    negative = true;
    text = parenthesized[1].trim();
  }

  // El signo se retira **antes** que la divisa: los extractos lo imprimen
  // pegado a la etiqueta —`-Bs 50.00`—, de modo que buscar la etiqueta primero
  // dejaría el signo huérfano y la ficha sin leer.
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1).trim();
  } else if (text.startsWith('+')) {
    text = text.slice(1).trim();
  }

  text = stripCurrency(text);

  if (CREDIT_SUFFIX.test(text)) {
    indicator = 'CREDIT';
    text = text.replace(CREDIT_SUFFIX, '').trim();
  } else if (DEBIT_SUFFIX.test(text)) {
    indicator = 'DEBIT';
    negative = true;
    text = text.replace(DEBIT_SUFFIX, '').trim();
  }

  if (text.endsWith('-')) {
    negative = true;
    text = text.slice(0, -1).trim();
  }

  const digits = toCanonicalDigits(text, format);
  if (!digits) return { value: '' };

  const numeric = Number(digits);
  if (!Number.isFinite(numeric)) return { value: '' };
  const signed = negative ? -Math.abs(numeric) : numeric;
  return { value: signed.toFixed(2), indicator };
}

/** `true` si la ficha se puede leer como importe en la convención dada. */
export function looksLikeAmount(raw: string, format?: NumberFormat): boolean {
  return parseAmount(raw, format).value !== '';
}

function stripCurrency(value: string): string {
  return value.replace(CURRENCY_LABEL, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Deja solo dígitos y un punto decimal. Rechaza lo que no encaje del todo en la
 * convención: es preferible no leer un importe a leerlo por la mitad.
 */
function toCanonicalDigits(value: string, format: NumberFormat): string {
  const compact = value.replace(/\s/g, '');
  if (!/^\d[\d.,]*$/.test(compact)) return '';

  const decimal = format.decimalSeparator;
  const thousand = format.thousandSeparator;
  const withoutThousands = thousand ? compact.split(thousand).join('') : compact;
  const normalized = decimal === ',' ? withoutThousands.replace(',', '.') : withoutThousands;

  // Tras retirar los miles no puede quedar más de un separador decimal.
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return '';
  return normalized;
}
