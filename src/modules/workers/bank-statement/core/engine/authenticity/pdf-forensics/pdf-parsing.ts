/** Lee el diccionario `/Info`, que es donde el generador deja su nombre. */
export function readInfoDictionary(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ['Producer', 'Creator', 'CreationDate', 'ModDate', 'Title', 'Author']) {
    const literal = new RegExp(`/${key}\\s*\\(((?:\\\\.|[^\\\\()])*)\\)`).exec(raw);
    if (literal?.[1] !== undefined) {
      out[key] = decodePdfText(literal[1]);
      continue;
    }
    const hex = new RegExp(`/${key}\\s*<([0-9A-Fa-f\\s]+)>`).exec(raw);
    if (hex?.[1] !== undefined) out[key] = decodeHex(hex[1]);
  }
  return out;
}

function decodePdfText(value: string): string {
  const unescaped = value
    .replace(/\\([0-7]{1,3})/g, (_, code: string) => String.fromCharCode(parseInt(code, 8)))
    .replace(/\\(.)/g, '$1');
  // UTF-16BE con marca de orden: lo escriben Word y varios editores.
  if (unescaped.charCodeAt(0) === 0xfe && unescaped.charCodeAt(1) === 0xff) {
    let out = '';
    for (let index = 2; index + 1 < unescaped.length; index += 2) {
      out += String.fromCharCode(
        (unescaped.charCodeAt(index) << 8) | unescaped.charCodeAt(index + 1),
      );
    }
    return out.trim();
  }
  return unescaped.trim();
}

function decodeHex(value: string): string {
  const digits = value.replace(/\s+/g, '');
  let out = '';
  for (let index = 0; index + 1 < digits.length; index += 2) {
    const code = parseInt(digits.slice(index, index + 2), 16);
    if (Number.isFinite(code) && code >= 32) out += String.fromCharCode(code);
  }
  return out.trim();
}

/** `D:20260415103000-04'00'` → `Date`. Devuelve `null` ante cualquier duda. */
export function parsePdfDate(value: string | undefined): Date | null {
  if (!value) return null;
  const match =
    /D?:?\s*(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([-+Z])(\d{2})'?(\d{2})?)?/.exec(
      value,
    );
  if (!match) return null;
  const [, year, month, day, hour, minute, second, sign, offsetHours, offsetMinutes] = match;
  const iso =
    `${year}-${month ?? '01'}-${day ?? '01'}T${hour ?? '00'}:${minute ?? '00'}:${second ?? '00'}` +
    (sign && sign !== 'Z'
      ? `${sign}${offsetHours ?? '00'}:${offsetMinutes ?? '00'}`
      : sign === 'Z'
        ? 'Z'
        : 'Z');
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function countMatches(raw: string, pattern: RegExp): number {
  return [...raw.matchAll(pattern)].length;
}

/**
 * Las catorce fuentes estándar del formato, que ningún generador incrusta.
 *
 * El nombre puede venir con un prefijo de subconjunto (`ABCDEF+Helvetica`) y con
 * sufijos de estilo (`Helvetica-Bold`), así que se compara por la raíz.
 */
const STANDARD_FONTS = ['helvetica', 'times', 'courier', 'symbol', 'zapfdingbats', 'arial'];

export function isStandardFont(baseFont: string): boolean {
  const root = baseFont
    .replace(/^[A-Z]{6}\+/, '')
    .toLowerCase()
    .replace(/[-,].*$/, '');
  return STANDARD_FONTS.some((standard) => root.startsWith(standard));
}
