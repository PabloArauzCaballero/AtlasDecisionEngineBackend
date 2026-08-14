/**
 * La guardia: qué SQL se deja llegar a la base.
 *
 * Es la PRIMERA de tres barreras, y conviene tener claro que ninguna de las tres se
 * sostiene sola:
 *
 *  1. Esta guardia léxica. Rápida, y sobre todo EXPLICATIVA: rechaza antes de abrir
 *     transacción y dice en qué línea y por qué. Es la que hace que la consola se pueda
 *     usar sin adivinar.
 *  2. El privilegio del rol de base de datos (`atlas_sql_console`, o `atlas_reader` cuando
 *     aquél no está provisionado) más `transaction_read_only` y un `search_path` acotado a
 *     los cinco datasets. Ésta es la barrera REAL: aunque la guardia tuviera un agujero, el
 *     rol no puede escribir porque no tiene el permiso.
 *  3. La inspección del plan (`query-executor.service.ts`): antes de ejecutar se pide el
 *     plan y se comprueba que toda relación recorrida pertenezca a un dataset. Es la que
 *     atrapa lo que un analizador léxico no puede ver —una función que lee otra tabla, una
 *     vista encadenada— porque pregunta al planificador en vez de al texto.
 *
 * Escribir sólo la (1) es el error clásico: una guardia de expresiones regulares que se
 * cree un intérprete. Escribir sólo la (2) deja al analista con `permission denied for
 * table decision_execution`, que no explica nada. Las tres juntas dan un sistema que
 * bloquea de verdad y además sabe decir por qué.
 */
import { QUALIFIED_RELATIONS } from '../catalog/dataset-catalog';
import { positionOf, scanSql } from './sql-tokens';

export interface GuardViolation {
  readonly code: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export interface GuardResult {
  readonly ok: boolean;
  readonly violations: readonly GuardViolation[];
  /** Relaciones del catálogo que la consulta nombra. Vacío no significa que no lea nada. */
  readonly relations: readonly string[];
}

/** Tope de la sentencia. Muy por encima de cualquier consulta escrita a mano. */
export const MAX_SQL_BYTES = 64 * 1024;

/**
 * Palabras que no pueden aparecer NUNCA, ni siquiera en un sitio donde serían inofensivas.
 *
 * La lista es deliberadamente más ancha de lo estrictamente necesario. `SET` dentro de una
 * consulta de sólo lectura no haría daño, pero admitirlo obliga a razonar sobre dónde
 * aparece, y ese razonamiento es justo donde estas guardias fallan. Aquí la regla es
 * binaria y por eso es auditable: si la palabra está, se rechaza.
 *
 * `INTO` merece una nota porque no parece peligrosa: `SELECT … INTO tabla` CREA una tabla.
 * Es la única forma de escribir que se disfraza de lectura, y es la que se olvida.
 */
const FORBIDDEN_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'UPSERT', 'TRUNCATE', 'DROP', 'CREATE', 'ALTER',
  'GRANT', 'REVOKE', 'COMMENT', 'COPY', 'VACUUM', 'REINDEX', 'CLUSTER', 'LOCK', 'SET',
  'RESET', 'DECLARE', 'FETCH', 'MOVE', 'CLOSE', 'PREPARE', 'EXECUTE', 'DEALLOCATE', 'DO',
  'CALL', 'LISTEN', 'NOTIFY', 'UNLISTEN', 'BEGIN', 'START', 'COMMIT', 'ROLLBACK',
  'SAVEPOINT', 'REFRESH', 'IMPORT', 'INTO', 'RETURNING', 'SECURITY', 'ANALYZE', 'EXPLAIN',
  'CHECKPOINT', 'DISCARD', 'LOAD', 'SHOW',
] as const;

/**
 * Funciones que leen fuera de los datasets o mueven el suelo bajo la sesión.
 *
 * `current_setting` y `set_config` están aquí por el mismo motivo, y es el importante de
 * todos: `set_config('app.tenant_id', '99', true)` dentro de una subconsulta cambiaría el
 * tenant que resuelven las vistas. Sin esta línea, toda la tenencia del módulo —que
 * descansa en ese GUC— sería falsificable desde el propio cuadro de texto.
 */
const FORBIDDEN_FUNCTIONS = [
  'current_setting', 'set_config', 'pg_sleep', 'pg_sleep_for', 'pg_sleep_until',
  'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file', 'pg_logdir_ls',
  'lo_import', 'lo_export', 'lo_get', 'lo_put', 'dblink', 'dblink_exec', 'dblink_connect',
  'pg_terminate_backend', 'pg_cancel_backend', 'pg_reload_conf', 'pg_rotate_logfile',
  'query_to_xml', 'database_to_xml', 'schema_to_xml', 'table_to_xml',
  'pg_get_viewdef', 'pg_get_functiondef', 'pg_get_expr', 'pg_get_userbyid',
  'atlas_current_tenant', 'pg_backend_pid', 'has_table_privilege', 'to_regclass',
] as const;

/**
 * Lo mismo, para las que se escriben SIN paréntesis.
 *
 * `current_user` y compañía son palabras clave del estándar, no llamadas: buscarlas con la
 * regla de función (`nombre(`) no las encontraría nunca. Delatan el rol de base de datos
 * con el que corre la consola, que es topología y no negocio.
 */
const FORBIDDEN_BARE_WORDS = [
  'current_user', 'session_user', 'current_catalog', 'current_schema', 'current_database',
] as const;

/**
 * Funciones que DEVUELVEN filas y sí se admiten tras `FROM`.
 *
 * `generate_series` no es un capricho: sin ella no se puede escribir una serie de fechas
 * completa, y sin serie completa toda consulta «por día» esconde los días en que no pasó
 * nada. Un hueco invisible en una serie temporal es exactamente el error que una consola de
 * análisis tiene que poner difícil de cometer.
 */
const TABLE_FUNCTIONS: ReadonlySet<string> = new Set([
  'generate_series',
  'unnest',
  'jsonb_array_elements',
  'json_array_elements',
]);

/** Prefijos y esquemas que no se nombran, escritos con comillas o sin ellas. */
const FORBIDDEN_NAME_PATTERNS: readonly RegExp[] = [
  /^pg_/i,
  /^information_schema$/i,
  /^pg_catalog$/i,
  /^public$/i,
];

const WORD = (word: string) => new RegExp(`(?<![A-Za-z0-9_."])${word}(?![A-Za-z0-9_])`, 'i');
const FUNCTION_CALL = (name: string) => new RegExp(`(?<![A-Za-z0-9_."])${name}\\s*\\(`, 'i');

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

export function guardSql(sql: string): GuardResult {
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
      push('SQL_FORBIDDEN_NAME', `El identificador "${quoted}" no es consultable desde la consola.`);
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
    if (QUALIFIED_RELATIONS.has(reference.name)) {
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
