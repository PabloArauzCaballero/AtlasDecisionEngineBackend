import { positionOf, scanSql } from '../sql-tokens';
import {
  FORBIDDEN_BARE_WORDS,
  FORBIDDEN_FUNCTIONS,
  FORBIDDEN_KEYWORDS,
  FORBIDDEN_NAME_PATTERNS,
  FUNCTION_CALL,
  TABLE_FUNCTIONS,
  WORD,
} from './forbidden-lists';
import { GuardResult, GuardViolation, MAX_SQL_BYTES } from './types';

/**
 * Caracteres de control, comprobados por código y no con una expresión regular.
 *
 * El byte nulo es el que importa: trunca la cadena para unos lectores y no para otros, y
 * esa discrepancia es justo por donde se cuela texto que la guardia no llega a mirar. Se
 * recorre a mano para que el archivo fuente no tenga que CONTENER un carácter de control
 * —ni siquiera escapado—, que es una forma tonta de romper el formateador y el diff.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    // Tabulador, salto de línea y retorno de carro son espaciado legítimo en SQL.
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true;
  }
  return false;
}

/** Nombres declarados por la propia consulta con `WITH`. No son relaciones del catálogo. */
function commonTableExpressions(masked: string): Set<string> {
  const names = new Set<string>();
  // `WITH x AS (…), y AS (…)`, y también `WITH RECURSIVE`. Se buscan todos los `nombre AS (`
  // porque un alias de columna nunca va seguido de un paréntesis de apertura.
  const pattern =
    /(?<![A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_]*)\s+AS\s*(?:NOT\s+MATERIALIZED\s+|MATERIALIZED\s+)?\(/gi;
  for (const match of masked.matchAll(pattern)) names.add(match[1].toLowerCase());
  return names;
}

interface RelationReference {
  readonly name: string;
  readonly index: number;
  /** Va seguido de `(`, así que es una llamada a función y no una tabla. */
  readonly isCall: boolean;
}

/** Relaciones nombradas tras FROM o JOIN, con la posición en la que aparecen. */
function referencedRelations(masked: string): RelationReference[] {
  const found: RelationReference[] = [];
  // `(?!\()` descarta las subconsultas `FROM (SELECT …)`, que no nombran nada.
  const pattern =
    /(?<![A-Za-z0-9_.])(?:FROM|JOIN)\s+(?:ONLY\s+|LATERAL\s+)*(?!\()([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)\s*(\()?/gi;
  for (const match of masked.matchAll(pattern)) {
    found.push({
      name: match[1].toLowerCase(),
      index: match.index + match[0].indexOf(match[1]),
      isCall: match[2] === '(',
    });
  }
  return found;
}

/**
 * La lista blanca llega COMO PARÁMETRO, no se importa.
 *
 * Antes era una constante del módulo, y por eso la guardia no podía admitir una vista que la
 * base publicara después de compilar: la lista y el despliegue eran la misma cosa. Ahora la
 * pone quien llama con lo que `CatalogDiscoveryService` encontró en `pg_catalog`, así que
 * admitir una relación nueva no necesita un despliegue — y sigue sin poder admitir nada que
 * la base no publique, que es la propiedad que había que conservar.
 *
 * No tiene valor por omisión a propósito. Un respaldo silencioso a la lista escrita a mano
 * dejaría a un llamador que se olvidara de pasarla funcionando con el catálogo de hace tres
 * migraciones, sin un solo síntoma hasta que alguien consultara la vista nueva.
 */
export function guardSql(sql: string, allowed: ReadonlySet<string>): GuardResult {
  const violations: GuardViolation[] = [];
  const push = (code: string, message: string, index?: number) => {
    const at = index === undefined ? {} : positionOf(sql, index);
    violations.push({ code, message, ...at });
  };
  const abort = (): GuardResult => ({ ok: false, violations, relations: [] });

  if (Buffer.byteLength(sql, 'utf8') > MAX_SQL_BYTES) {
    push('SQL_TOO_LARGE', `La consulta supera ${MAX_SQL_BYTES} bytes.`);
    return abort();
  }
  if (hasControlCharacter(sql)) {
    push('SQL_INVALID_CHARACTER', 'La consulta contiene caracteres de control.');
    return abort();
  }

  const scan = scanSql(sql);
  if (scan.unterminated) {
    push('SQL_UNTERMINATED', `Hay un ${scan.unterminated} sin cerrar.`);
    return abort();
  }
  if (scan.hasDollarQuoted) {
    push(
      'SQL_DOLLAR_QUOTED',
      'Las cadenas delimitadas con dólar ($$…$$) no se admiten. Usa comillas simples.',
    );
  }

  const masked = scan.masked;

  // Una sentencia y sólo una. El `;` final se tolera porque todo el mundo lo escribe.
  const semicolon = masked.indexOf(';');
  if (semicolon !== -1 && masked.slice(semicolon + 1).trim().length > 0) {
    push(
      'SQL_MULTIPLE_STATEMENTS',
      'Sólo se admite una sentencia por consulta. Quita el punto y coma intermedio.',
      semicolon,
    );
  }

  const body = (semicolon === -1 ? masked : masked.slice(0, semicolon)).trim();
  if (body.length === 0) {
    push('SQL_EMPTY', 'La consulta está vacía.');
    return abort();
  }

  if (!/^(SELECT|WITH)\b/i.test(body)) {
    push(
      'SQL_NOT_A_QUERY',
      'La consola sólo ejecuta consultas: empieza por SELECT o por WITH.',
      masked.length - masked.trimStart().length,
    );
  }

  for (const keyword of FORBIDDEN_KEYWORDS) {
    const match = WORD(keyword).exec(masked);
    if (!match) continue;
    push(
      'SQL_FORBIDDEN_KEYWORD',
      `\`${keyword}\` no se admite: la consola es de sólo lectura y no ejecuta nada que no ` +
        'sea una consulta.',
      match.index,
    );
  }

  for (const word of FORBIDDEN_BARE_WORDS) {
    const match = WORD(word).exec(masked);
    if (match) {
      push('SQL_FORBIDDEN_FUNCTION', `\`${word}\` no está disponible en la consola.`, match.index);
    }
  }

  for (const fn of FORBIDDEN_FUNCTIONS) {
    const match = FUNCTION_CALL(fn).exec(masked);
    if (match) {
      push(
        'SQL_FORBIDDEN_FUNCTION',
        `La función \`${fn}()\` no está disponible en la consola.`,
        match.index,
      );
    }
  }

  // Los identificadores entre comillas se revisan aparte porque el enmascarado los saca del
  // texto: sin esto, `FROM "pg_class"` pasaría la comprobación de arriba sin tocarla.
  for (const quoted of scan.quotedIdentifiers) {
    const bare = quoted.includes('.') ? quoted.split('.')[0] : quoted;
    if (FORBIDDEN_NAME_PATTERNS.some((pattern) => pattern.test(bare))) {
      push(
        'SQL_FORBIDDEN_NAME',
        `El identificador "${quoted}" no es consultable desde la consola.`,
      );
    }
  }

  // El enmascarado borra el contenido de los identificadores entre comillas, así que
  // `"query_to_xml"(…)` no coincide con ninguna regla de función de arriba. Se revisa cada
  // uno por su valor, esté donde esté: una función prohibida no deja de serlo por escribirse
  // entre comillas, en mayúsculas o calificada con esquema (`pg_catalog."set_config"(`).
  const forbiddenFunctionNames = new Set<string>(FORBIDDEN_FUNCTIONS);
  const forbiddenBare = new Set<string>(FORBIDDEN_BARE_WORDS);
  for (const range of scan.quotedRanges) {
    if (range.unicodeEscaped) {
      // `U&"…\\0071uery…"` se resuelve en la base, no aquí: no se intenta decodificar, se
      // rechaza. Ninguna consulta de análisis necesita escribir un nombre con escapes.
      push(
        'SQL_UNICODE_ESCAPE',
        'Los identificadores con escapes unicode (U&"…") no se admiten.',
        range.start,
      );
      continue;
    }
    const lowered = range.value.toLowerCase();
    if (forbiddenFunctionNames.has(lowered) || forbiddenBare.has(lowered)) {
      push(
        'SQL_FORBIDDEN_FUNCTION',
        `El identificador "${range.value}" nombra una función que no está disponible en la consola.`,
        range.start,
      );
      continue;
    }
    // Un identificador entre comillas seguido de `(` es una llamada a función. Sólo se
    // tolera como lista de columnas de un alias (`AS "t"(a, b)`); calificado con esquema
    // (`"pg_catalog"."x"(`) o suelto no se admite.
    const after = masked.slice(range.end).trimStart();
    const before = masked.slice(0, range.start).trimEnd();
    if (after.startsWith('(') && !/\bAS$/i.test(before)) {
      push(
        'SQL_FORBIDDEN_FUNCTION',
        `No se admite llamar a "${range.value}"(…): los nombres de función no van entre comillas.`,
        range.start,
      );
    }
  }

  const ctes = commonTableExpressions(masked);
  const relations = new Set<string>();
  for (const reference of referencedRelations(masked)) {
    if (ctes.has(reference.name)) continue;
    if (reference.isCall) {
      if (!TABLE_FUNCTIONS.has(reference.name)) {
        push(
          'SQL_FORBIDDEN_FUNCTION',
          `\`${reference.name}()\` no se admite como origen de filas.`,
          reference.index,
        );
      }
      continue;
    }
    if (allowed.has(reference.name)) {
      relations.add(reference.name);
      continue;
    }
    const [schema] = reference.name.split('.');
    const hint = FORBIDDEN_NAME_PATTERNS.some((pattern) => pattern.test(schema))
      ? 'Los catálogos internos de PostgreSQL no son consultables.'
      : 'Mira el explorador de la izquierda para ver las tablas disponibles.';
    push(
      'SQL_UNKNOWN_RELATION',
      `\`${reference.name}\` no existe en los datasets de la consola. ${hint}`,
      reference.index,
    );
  }

  return { ok: violations.length === 0, violations, relations: [...relations] };
}
