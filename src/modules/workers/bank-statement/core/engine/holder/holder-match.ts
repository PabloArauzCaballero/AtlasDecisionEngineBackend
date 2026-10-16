/**
 * ¿El extracto es de una cuenta del cliente que lo sube? (Pablo, 2026-10-16: «que el nombre del usuario
 * coincida con el nombre del extracto bancario»).
 *
 * Sin esta comprobación, el extracto de cualquier otra persona —un familiar con mejor sueldo, uno bajado de
 * internet— medía la capacidad de pago de quien lo subía. Las tres compuertas de admisión miran el ARCHIVO,
 * el CONTENIDO y el EMISOR; ninguna miraba de QUIÉN es la cuenta.
 *
 * ## La regla
 *
 * Coincide si en ALGÚN titular del documento (titular y cotitulares) aparecen **al menos un nombre de pila y
 * al menos un apellido** del cliente. Antes de comparar se normaliza: mayúsculas, sin tildes ni signos,
 * espacios colapsados, sin partículas («DE», «DEL», «LA», «Y», «VDA.»…), y el orden da igual —los bancos
 * bolivianos imprimen «PEREZ GOMEZ JUAN CARLOS» y el registro guarda «Juan Carlos Pérez Gómez»—. Un nombre de
 * pila puede venir como inicial («J. PEREZ»). Una letra de diferencia en una palabra de cinco o más se tolera:
 * es lo que deja el reconocimiento óptico («PERES» por «PEREZ»), no otra persona.
 *
 * Con un nombre esperado sin separar en nombres y apellidos (llamadas antiguas), basta con que coincidan dos
 * palabras significativas, o la única que haya.
 *
 * ## Los cuatro veredictos, y por qué el ilegible NO se rechaza
 *
 * - `MATCH`: sigue el camino de siempre.
 * - `MISMATCH`: rechazo. La acción del cliente es subir el extracto de una cuenta suya.
 * - `UNREADABLE`: el motor no encontró un nombre de persona en la carátula, o lo que encontró se parece más a
 *   un rótulo del banco que a un nombre. Va a una persona: rechazar acusaría al cliente de un fallo de lectura
 *   nuestro.
 * - `NOT_REQUIRED`: nadie exigió un titular (la Consola del portal). Se informa lo leído y no se decide nada.
 */

export type HolderVerdict = 'MATCH' | 'MISMATCH' | 'UNREADABLE' | 'NOT_REQUIRED';

export interface ExpectedHolder {
  /** El nombre completo, tal como lo registró el cliente. Es lo que se enseña a quien revisa. */
  readonly fullName: string;
  /** Nombres de pila, si el emisor los distingue. Mejora la regla: sin ellos se cuenta por palabras. */
  readonly givenNames?: string | null;
  readonly surnames?: string | null;
}

export interface HolderAssessment {
  readonly verdict: HolderVerdict;
  /** Los titulares que se leyeron, ya separados. Vacío si no se leyó ninguno. */
  readonly holdersRead: readonly string[];
  readonly reason: string;
}

/** Palabras que no identifican a una persona: unen apellidos o tratan a alguien. */
const PARTICLES = new Set([
  'DE',
  'DEL',
  'LA',
  'LAS',
  'LOS',
  'Y',
  'E',
  'VDA',
  'VIUDA',
  'SR',
  'SRA',
  'SRTA',
  'DON',
  'DONA',
  'SENOR',
  'SENORA',
]);

/** Si aparecen, lo leído no es un nombre de persona sino un rótulo o un dato del banco. */
const NOT_A_PERSON = new Set([
  'BANCO',
  'BANCA',
  'CUENTA',
  'CAJA',
  'AHORRO',
  'AHORROS',
  'CORRIENTE',
  'EXTRACTO',
  'MOVIMIENTOS',
  'FECHA',
  'SALDO',
  'BOLIVIANOS',
  'DOLARES',
  'NRO',
  'NUMERO',
  'SUCURSAL',
  'MONEDA',
  'PERIODO',
  'COOPERATIVA',
  'MUTUAL',
  'FONDO',
  'FINANCIERA',
  'ENTIDAD',
  'PAGINA',
  'SA',
  'LTDA',
  'SRL',
  'IFD',
  'CLIENTE',
  'TITULAR',
]);

/** Une a varios titulares en una sola línea: «JUAN PEREZ Y MARIA LOPEZ», «JUAN PEREZ / MARIA LOPEZ». */
const HOLDER_SEPARATOR = /\s+(?:Y\/O|Y|O|E)\s+(?=[A-ZÑ]{2,}\s+[A-ZÑ]{2,})|[/;|\n]+|\s{2,}/;

export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z\s/;|\n]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Las palabras que identifican a alguien: sin partículas, sin tratamientos, sin letras sueltas salvo iniciales. */
export function nameTokens(value: string): string[] {
  return normalizeText(value)
    .split(/[\s/;|\n]+/)
    .filter((token) => token.length > 0 && !PARTICLES.has(token));
}

function splitHolders(raw: string): string[] {
  const upper = normalizeText(raw);
  return upper
    .split(HOLDER_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Misma palabra, o casi la misma en una palabra larga (un error de lectura, no otra persona). */
function sameToken(expected: string, read: string): boolean {
  if (expected === read) return true;
  return expected.length >= 5 && read.length >= 5 && editDistanceAtMostOne(expected, read);
}

function containsToken(holder: readonly string[], token: string, allowInitial: boolean): boolean {
  return holder.some(
    (read) => sameToken(token, read) || (allowInitial && read.length === 1 && read === token[0]),
  );
}

/** Lo leído parece un nombre de persona: dos palabras o más y ninguna propia de un rótulo del banco. */
function looksLikePerson(tokens: readonly string[]): boolean {
  const words = tokens.filter((token) => token.length > 1);
  return words.length >= 2 && !tokens.some((token) => NOT_A_PERSON.has(token));
}

function holderMatches(holder: readonly string[], expected: ExpectedHolder): boolean {
  const given = expected.givenNames ? nameTokens(expected.givenNames) : [];
  const surnames = expected.surnames ? nameTokens(expected.surnames) : [];
  if (given.length > 0 && surnames.length > 0) {
    const givenOk = given.some((token) => containsToken(holder, token, true));
    const surnameOk = surnames.some((token) => containsToken(holder, token, false));
    return givenOk && surnameOk;
  }
  const tokens = nameTokens(expected.fullName).filter((token) => token.length > 1);
  if (tokens.length === 0) return false;
  const needed = Math.min(2, tokens.length);
  return tokens.filter((token) => containsToken(holder, token, false)).length >= needed;
}

/**
 * Compara el titular leído con el esperado.
 *
 * `holderRead` es la línea tal como la extrajo el analizador (puede traer varios titulares). `expected`
 * nulo o vacío: nadie exigió titular.
 */
export function assessHolder(
  holderRead: string | null | undefined,
  expected: ExpectedHolder | null,
): HolderAssessment {
  const holders = holderRead ? splitHolders(holderRead) : [];
  const people = holders.map(nameTokens).filter(looksLikePerson);
  const holdersRead = people.map((tokens) => tokens.join(' '));

  if (!expected || nameTokens(expected.fullName).length === 0) {
    return { verdict: 'NOT_REQUIRED', holdersRead, reason: 'sin-titular-exigido' };
  }
  if (people.length === 0) {
    return {
      verdict: 'UNREADABLE',
      holdersRead,
      reason: holders.length === 0 ? 'sin-titular-en-la-caratula' : 'lo-leido-no-es-un-nombre',
    };
  }
  return people.some((holder) => holderMatches(holder, expected))
    ? { verdict: 'MATCH', holdersRead, reason: 'nombre-y-apellido-coinciden' }
    : { verdict: 'MISMATCH', holdersRead, reason: 'ningun-titular-coincide' };
}
