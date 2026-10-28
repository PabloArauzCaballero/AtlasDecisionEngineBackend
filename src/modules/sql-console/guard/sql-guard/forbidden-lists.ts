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
  // Revelan la topología del servidor: reconocimiento gratis para quien ataca.
  'inet_server_addr',
  'inet_server_port',
  'inet_client_addr',
  'inet_client_port',
  // Objetos grandes: son globales a la base, no pertenecen a ningún tenant ni a ningún dataset.
  'lo_open',
  'lo_creat',
  'lo_create',
  'lo_close',
  'lo_lseek',
  'lo_lseek64',
  'lo_tell',
  'lo_tell64',
  'lo_truncate',
  'lo_truncate64',
  'lo_unlink',
  'loread',
  'lowrite',
] as const;

/**
 * Funciones prohibidas SOLO como llamada, no como nombre.
 *
 * `version()` revela la versión del servidor, pero `version` es también una columna de los datasets
 * (`catalogo`, `auditoria`, `decisiones`, `desenlaces`): meterla en `FORBIDDEN_FUNCTIONS` rechazaría
 * `"version"` entre comillas, que es un nombre de columna legítimo.
 */
export const FORBIDDEN_CALLS_ONLY = ['version'] as const;

/**
 * Las funciones `pg_*` que SÍ se admiten. Lista cerrada, y mínima a propósito.
 *
 * Antes la guardia prohibía `pg_*` una a una, y la lista nunca estuvo completa: `pg_advisory_lock`
 * pasaba, y es una función de VOLATILIDAD que una transacción de sólo lectura no impide. Su candado
 * es de sesión, así que sobrevive al `COMMIT` en la conexión que vuelve al pool: un solo
 * `SELECT count(pg_advisory_lock(g)) FROM generate_series(1, 30000) g` llena la tabla de candados
 * compartida y, mientras esa conexión siga viva, el resto de las sesiones —y las conexiones nuevas—
 * fallan con `out of shared memory`. Medido contra PostgreSQL 16 con los valores por omisión.
 * `pg_notify` tiene el mismo problema por otro lado: envía a los canales que escucha el propio motor.
 *
 * Por eso se invierte el criterio: todo `pg_*(…)` está prohibido salvo lo que figura aquí. Una
 * función nueva de PostgreSQL nace prohibida, que es la dirección segura de equivocarse.
 */
export const ALLOWED_PG_FUNCTIONS: ReadonlySet<string> = new Set(['pg_typeof']);

/** Una llamada a una función `pg_*`, con o sin esquema delante (`pg_catalog.pg_notify(`). */
export const PG_FUNCTION_CALL = /(?<![A-Za-z0-9_"])(pg_[A-Za-z0-9_]+)\s*\(/gi;

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
