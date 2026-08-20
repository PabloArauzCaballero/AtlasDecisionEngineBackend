/**
 * Construcción de una cadena que SATISFACE un `pattern` del contrato (§10.3).
 *
 * El generador guiado por contrato ignoraba `pattern`: rellenaba con letras al azar y
 * devolvía como VÁLIDO un valor que el motor de restricciones rechazaba acto seguido. Un
 * banco de pruebas que se contradice a sí mismo no se mira dos veces, así que aquí el
 * patrón se lee y se produce una cadena que casa con él.
 *
 * ## Por qué un intérprete propio y no una librería
 *
 * `randexp` y equivalentes son dependencias de PRODUCCIÓN que ejecutarían un patrón
 * escrito por el autor del contrato, y su algoritmo puede cambiar entre versiones
 * menores: una corrida archivada dejaría de reproducirse. Aquí el subconjunto soportado
 * está congelado en el repositorio, versionado con `GENERATOR_VERSION`, y consume el
 * mismo flujo determinista que el resto del generador.
 *
 * ## Subconjunto soportado
 *
 * Literales, `.`, clases `[a-z0-9]` (con negación y rangos), `\d \w \s` y sus negados,
 * grupos `( … )` y `(?: … )`, alternancia `|`, cuantificadores `* + ? {n} {n,} {n,m}` y
 * anclas `^ $`. Lo demás —retrorreferencias, lookaround, `\u`, propiedades Unicode— NO
 * se soporta: se devuelve `null` y quien llama decide qué hacer. Fallar declarándolo es
 * la única opción honesta; inventar una cadena que no casa es lo que ya hacía antes.
 *
 * Toda cadena producida se COMPRUEBA contra el patrón real antes de devolverse, de modo
 * que un fallo del intérprete nunca puede escaparse como valor válido.
 */
import { isPotentiallyCatastrophic, safeRegexTest } from '../../common/validation/safe-regex';
import type { SeededRandom } from './seeded-random';

const DIGITS = '0123456789';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const WORD = `${LOWER}${UPPER}${DIGITS}_`;
/** Alfabeto para `.` y para los negados: imprimible, sin espacios ni sorpresas. */
const ANY = `${LOWER}${UPPER}${DIGITS}`;

/**
 * Tope de caracteres emitidos por intento. Un `{1,100000}` es un patrón legítimo pero
 * pedirle su cadena completa reventaría la memoria del proceso por una entrada de
 * prueba; se corta y la comprobación final descarta el intento.
 */
const EMISSION_BUDGET = 512;
/** Repeticiones añadidas sobre el mínimo en un cuantificador abierto (`*`, `+`, `{n,}`). */
const OPEN_REPEAT_SLACK = 2;

type PatternNode =
  | { kind: 'literal'; text: string }
  | { kind: 'class'; chars: readonly string[] }
  | { kind: 'group'; alternatives: PatternNode[][] }
  | { kind: 'repeat'; node: PatternNode; min: number; max: number };

interface Cursor {
  source: string;
  index: number;
  failed: boolean;
}

/**
 * Una cadena que casa con `pattern`, o `null` si el patrón usa construcciones no
 * soportadas o si ningún intento superó `accepts` (por ejemplo, la longitud declarada).
 */
export function sampleForPattern(
  pattern: string,
  random: SeededRandom,
  accepts: (candidate: string) => boolean = () => true,
  attempts = 12,
): string | null {
  // Un patrón con retroceso catastrófico no se compila ni para comprobar: `safeRegexTest`
  // fallaría cerrado y todos los intentos se descartarían igualmente.
  if (isPotentiallyCatastrophic(pattern)) return null;
  const alternatives = parsePattern(pattern);
  if (!alternatives) return null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const budget = { left: EMISSION_BUDGET };
    const candidate = emitSequence(random.pick(alternatives), random, budget);
    if (budget.left > 0 && safeRegexTest(pattern, candidate).matched && accepts(candidate)) {
      return candidate;
    }
  }
  return null;
}

function parsePattern(pattern: string): PatternNode[][] | null {
  const cursor: Cursor = { source: pattern, index: 0, failed: false };
  const alternatives = parseAlternation(cursor);
  // Sobrar texto significa que se paró en un `)` sin abrir: el patrón no se entendió.
  if (cursor.failed || cursor.index < pattern.length) return null;
  return alternatives;
}

function parseAlternation(cursor: Cursor): PatternNode[][] {
  const alternatives: PatternNode[][] = [];
  let current: PatternNode[] = [];
  while (cursor.index < cursor.source.length && !cursor.failed) {
    if (cursor.source[cursor.index] === ')') break;
    if (cursor.source[cursor.index] === '|') {
      cursor.index += 1;
      alternatives.push(current);
      current = [];
      continue;
    }
    const node = parseQuantified(cursor);
    if (node) current.push(node);
  }
  alternatives.push(current);
  return alternatives;
}

function parseQuantified(cursor: Cursor): PatternNode | null {
  const atom = parseAtom(cursor);
  if (!atom) return null;
  const bounds = parseQuantifier(cursor);
  return bounds ? { kind: 'repeat', node: atom, min: bounds.min, max: bounds.max } : atom;
}

function parseAtom(cursor: Cursor): PatternNode | null {
  const char = cursor.source[cursor.index];
  // Las anclas no aportan caracteres: se consumen y no producen nodo.
  if (char === '^' || char === '$') {
    cursor.index += 1;
    return null;
  }
  if (char === '(') return parseGroup(cursor);
  if (char === '[') return parseClass(cursor);
  if (char === '.') {
    cursor.index += 1;
    return classNode(ANY);
  }
  if (char === '\\') return parseEscape(cursor);
  // Un cuantificador sin átomo delante es un patrón que no sabemos leer.
  if (char === '*' || char === '+' || char === '?' || char === '{') {
    cursor.failed = true;
    return null;
  }
  cursor.index += 1;
  return { kind: 'literal', text: char };
}

function parseGroup(cursor: Cursor): PatternNode | null {
  cursor.index += 1;
  if (cursor.source.startsWith('?:', cursor.index)) {
    cursor.index += 2;
  } else if (cursor.source[cursor.index] === '?') {
    // Lookahead, lookbehind o grupo con nombre: no se soportan.
    cursor.failed = true;
    return null;
  }
  const alternatives = parseAlternation(cursor);
  if (cursor.failed || cursor.source[cursor.index] !== ')') {
    cursor.failed = true;
    return null;
  }
  cursor.index += 1;
  return { kind: 'group', alternatives };
}

function parseClass(cursor: Cursor): PatternNode | null {
  cursor.index += 1;
  const negated = cursor.source[cursor.index] === '^';
  if (negated) cursor.index += 1;

  const chars: string[] = [];
  while (cursor.index < cursor.source.length && cursor.source[cursor.index] !== ']') {
    if (cursor.source[cursor.index] === '\\') {
      cursor.index += 1;
      chars.push(...classEscapeChars(cursor.source[cursor.index]));
      cursor.index += 1;
      continue;
    }
    const from = cursor.source[cursor.index];
    cursor.index += 1;
    const isRange =
      cursor.source[cursor.index] === '-' &&
      cursor.index + 1 < cursor.source.length &&
      cursor.source[cursor.index + 1] !== ']';
    if (!isRange) {
      chars.push(from);
      continue;
    }
    const to = cursor.source[cursor.index + 1];
    cursor.index += 2;
    for (let code = from.charCodeAt(0); code <= to.charCodeAt(0); code += 1) {
      chars.push(String.fromCharCode(code));
    }
  }
  if (cursor.source[cursor.index] !== ']') {
    cursor.failed = true;
    return null;
  }
  cursor.index += 1;

  const pool = negated ? [...ANY].filter((char) => !chars.includes(char)) : chars;
  // Una clase vacía (o una negación que excluye todo el alfabeto) no puede emitir nada.
  if (!pool.length) {
    cursor.failed = true;
    return null;
  }
  return { kind: 'class', chars: pool };
}

function classEscapeChars(escaped: string | undefined): string[] {
  switch (escaped) {
    case 'd':
      return [...DIGITS];
    case 'w':
      return [...WORD];
    case 's':
      return [' '];
    case 'n':
      return ['\n'];
    case 't':
      return ['\t'];
    default:
      return escaped === undefined ? [] : [escaped];
  }
}

function parseEscape(cursor: Cursor): PatternNode | null {
  cursor.index += 1;
  const escaped = cursor.source[cursor.index];
  if (escaped === undefined) {
    cursor.failed = true;
    return null;
  }
  cursor.index += 1;
  switch (escaped) {
    case 'd':
      return classNode(DIGITS);
    case 'D':
      return classNode(`${LOWER}${UPPER}_`);
    case 'w':
      return classNode(WORD);
    case 'W':
      return classNode('-.:@ ');
    case 's':
      return { kind: 'literal', text: ' ' };
    case 'S':
      return classNode(ANY);
    case 'n':
      return { kind: 'literal', text: '\n' };
    case 't':
      return { kind: 'literal', text: '\t' };
    // Límite de palabra: no aporta caracteres, pero tampoco impide generar.
    case 'b':
    case 'B':
      return null;
    default:
      // Retrorreferencias y escapes Unicode: no se pueden satisfacer construyendo.
      if (escaped >= '1' && escaped <= '9') {
        cursor.failed = true;
        return null;
      }
      if (['u', 'x', 'k', 'p', 'P', 'c'].includes(escaped)) {
        cursor.failed = true;
        return null;
      }
      return { kind: 'literal', text: escaped };
  }
}

function parseQuantifier(cursor: Cursor): { min: number; max: number } | null {
  const char = cursor.source[cursor.index];
  let bounds: { min: number; max: number } | null = null;

  if (char === '*') {
    cursor.index += 1;
    bounds = { min: 0, max: OPEN_REPEAT_SLACK };
  } else if (char === '+') {
    cursor.index += 1;
    bounds = { min: 1, max: 1 + OPEN_REPEAT_SLACK };
  } else if (char === '?') {
    cursor.index += 1;
    bounds = { min: 0, max: 1 };
  } else if (char === '{') {
    const close = cursor.source.indexOf('}', cursor.index);
    if (close < 0) return null;
    const parsed = /^(\d+)(,(\d*))?$/.exec(cursor.source.slice(cursor.index + 1, close));
    if (!parsed) return null;
    cursor.index = close + 1;
    const min = Number(parsed[1]);
    const max =
      parsed[2] === undefined ? min : parsed[3] ? Number(parsed[3]) : min + OPEN_REPEAT_SLACK;
    bounds = { min, max: Math.max(min, max) };
  }
  if (!bounds) return null;
  // Perezoso (`*?`) o posesivo (`*+`): casan el mismo conjunto de cadenas.
  if (cursor.source[cursor.index] === '?' || cursor.source[cursor.index] === '+') {
    cursor.index += 1;
  }
  return bounds;
}

function classNode(alphabet: string): PatternNode {
  return { kind: 'class', chars: [...alphabet] };
}

function emitSequence(
  nodes: readonly PatternNode[],
  random: SeededRandom,
  budget: { left: number },
): string {
  let out = '';
  for (const node of nodes) out += emitNode(node, random, budget);
  return out;
}

function emitNode(node: PatternNode, random: SeededRandom, budget: { left: number }): string {
  if (budget.left <= 0) return '';
  switch (node.kind) {
    case 'literal':
      budget.left -= node.text.length;
      return node.text;
    case 'class':
      budget.left -= 1;
      return random.pick(node.chars);
    case 'group':
      return emitSequence(random.pick(node.alternatives), random, budget);
    case 'repeat': {
      const times = random.int(node.min, node.max);
      let out = '';
      for (let repetition = 0; repetition < times && budget.left > 0; repetition += 1) {
        out += emitNode(node.node, random, budget);
      }
      return out;
    }
  }
}
