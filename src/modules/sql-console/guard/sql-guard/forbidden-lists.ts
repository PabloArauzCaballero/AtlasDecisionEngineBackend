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
export const FORBIDDEN_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'UPSERT',
  'TRUNCATE',
  'DROP',
  'CREATE',
  'ALTER',
  'GRANT',
  'REVOKE',
  'COMMENT',
  'COPY',
  'VACUUM',
  'REINDEX',
  'CLUSTER',
  'LOCK',
  'SET',
  'RESET',
  'DECLARE',
  'FETCH',
  'MOVE',
  'CLOSE',
  'PREPARE',
  'EXECUTE',
  'DEALLOCATE',
  'DO',
  'CALL',
  'LISTEN',
  'NOTIFY',
  'UNLISTEN',
  'BEGIN',
  'START',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
  'REFRESH',
  'IMPORT',
  'INTO',
  'RETURNING',
  'SECURITY',
  'ANALYZE',
  'EXPLAIN',
  'CHECKPOINT',
  'DISCARD',
  'LOAD',
  'SHOW',
] as const;

/**
 * Funciones que leen fuera de los datasets o mueven el suelo bajo la sesión.
 *
 * `current_setting` y `set_config` están aquí por el mismo motivo, y es el importante de
 * todos: `set_config('app.tenant_id', '99', true)` dentro de una subconsulta cambiaría el
 * tenant que resuelven las vistas. Sin esta línea, toda la tenencia del módulo —que
 * descansa en ese GUC— sería falsificable desde el propio cuadro de texto.
 */
export const FORBIDDEN_FUNCTIONS = [
  'current_setting',
  'set_config',
  'pg_sleep',
  'pg_sleep_for',
  'pg_sleep_until',
  'pg_read_file',
  'pg_read_binary_file',
  'pg_ls_dir',
  'pg_stat_file',
  'pg_logdir_ls',
  'lo_import',
  'lo_export',
  'lo_get',
  'lo_put',
  'dblink',
  'dblink_exec',
  'dblink_connect',
  'pg_terminate_backend',
  'pg_cancel_backend',
  'pg_reload_conf',
  'pg_rotate_logfile',
  'query_to_xml',
  'database_to_xml',
  'schema_to_xml',
  'table_to_xml',
  'pg_get_viewdef',
  'pg_get_functiondef',
  'pg_get_expr',
  'pg_get_userbyid',
  'atlas_current_tenant',
  'pg_backend_pid',
  'has_table_privilege',
  'to_regclass',
] as const;

/**
 * Lo mismo, para las que se escriben SIN paréntesis.
 *
 * `current_user` y compañía son palabras clave del estándar, no llamadas: buscarlas con la
 * regla de función (`nombre(`) no las encontraría nunca. Delatan el rol de base de datos
 * con el que corre la consola, que es topología y no negocio.
 */
export const FORBIDDEN_BARE_WORDS = [
  'current_user',
  'session_user',
  'current_catalog',
  'current_schema',
  'current_database',
] as const;

/**
 * Funciones que DEVUELVEN filas y sí se admiten tras `FROM`.
 *
 * `generate_series` no es un capricho: sin ella no se puede escribir una serie de fechas
 * completa, y sin serie completa toda consulta «por día» esconde los días en que no pasó
 * nada. Un hueco invisible en una serie temporal es exactamente el error que una consola de
 * análisis tiene que poner difícil de cometer.
 */
export const TABLE_FUNCTIONS: ReadonlySet<string> = new Set([
  'generate_series',
  'unnest',
  'jsonb_array_elements',
  'json_array_elements',
]);

/** Prefijos y esquemas que no se nombran, escritos con comillas o sin ellas. */
export const FORBIDDEN_NAME_PATTERNS: readonly RegExp[] = [
  /^pg_/i,
  /^information_schema$/i,
  /^pg_catalog$/i,
  /^public$/i,
];

export const WORD = (word: string) => new RegExp(`(?<![A-Za-z0-9_."])${word}(?![A-Za-z0-9_])`, 'i');
// Sin `.` en el lookbehind: `pg_catalog.set_config(` es la misma llamada que `set_config(`.
export const FUNCTION_CALL = (name: string) => new RegExp(`(?<![A-Za-z0-9_"])${name}\\s*\\(`, 'i');
