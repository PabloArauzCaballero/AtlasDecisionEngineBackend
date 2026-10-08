/**
 * Lo que esta batería fija no es «la guardia funciona», sino una lista concreta de formas
 * de rodearla que ya no van a volver.
 *
 * Cada caso de `rechaza` es una técnica documentada de evasión de guardias de SQL, no un
 * ejemplo inventado. La utilidad de tenerlas escritas está en el futuro: la próxima vez que
 * alguien relaje una regla para desatascar una consulta legítima, esta lista dice cuál era
 * el precio.
 */
import { QUALIFIED_RELATIONS } from '../catalog/dataset-catalog';
import { guardSql, MAX_SQL_BYTES } from './sql-guard';

/*
 * La lista blanca la pone quien llama —en producción, lo que `CatalogDiscoveryService`
 * encontró en `pg_catalog`—. Aquí se usa la derivada de la ficha escrita a mano porque esta
 * batería es sobre el ANALIZADOR, no sobre el descubrimiento: necesita un conjunto conocido y
 * estable de relaciones para poder afirmar qué se rechaza y por qué.
 */
const CATALOGO = QUALIFIED_RELATIONS;

const acepta = (sql: string) => expect(guardSql(sql, CATALOGO).ok).toBe(true);
const rechaza = (sql: string, code?: string) => {
  const result = guardSql(sql, CATALOGO);
  expect(result.ok).toBe(false);
  if (code) expect(result.violations.map((v) => v.code)).toContain(code);
};

describe('guardSql — lo que deja pasar', () => {
  it('admite una consulta simple sobre una tabla del catálogo', () => {
    acepta('SELECT estado, count(*) FROM decisiones.ejecuciones GROUP BY 1');
  });

  it('admite el nombre sin calificar, porque el search_path cubre los cinco datasets', () => {
    acepta('SELECT * FROM ejecuciones LIMIT 10');
  });

  it('admite CTEs, y no confunde su nombre con una tabla que no existe', () => {
    acepta(`
      WITH aprobadas AS (
        SELECT * FROM decisiones.ejecuciones WHERE estado = 'APPROVED'
      )
      SELECT count(*) FROM aprobadas
    `);
  });

  it('admite un CTE recursivo y uno materializado', () => {
    acepta(`
      WITH RECURSIVE serie AS (SELECT 1 AS n),
           cacheada AS MATERIALIZED (SELECT * FROM decisiones.motivos)
      SELECT * FROM serie, cacheada
    `);
  });

  it('admite generate_series, sin la cual toda serie temporal esconde los días vacíos', () => {
    acepta(`
      SELECT d::date, count(e.ejecucion_id)
      FROM generate_series(now() - interval '30 days', now(), interval '1 day') AS d
      LEFT JOIN decisiones.ejecuciones e ON e.ejecutada_en::date = d::date
      GROUP BY 1
    `);
  });

  it('admite cruzar datasets distintos', () => {
    acepta(`
      SELECT e.artefacto, o.desenlace, count(*)
      FROM decisiones.ejecuciones e
      JOIN desenlaces.observaciones o ON o.ejecucion_id = e.ejecucion_id
      GROUP BY 1, 2
    `);
  });

  it('admite un alias entre comillas dobles, que es como se pone un título legible', () => {
    acepta('SELECT count(*) AS "Total aprobado" FROM decisiones.ejecuciones');
  });

  it('admite el punto y coma final, porque todo el mundo lo escribe', () => {
    acepta('SELECT 1 FROM decisiones.ejecuciones;');
  });

  it('no confunde una palabra prohibida dentro de un literal con una sentencia', () => {
    acepta("SELECT * FROM auditoria.eventos WHERE tipo = 'ARTIFACT_UPDATE'");
  });

  it('no confunde dos guiones dentro de un literal con un comentario', () => {
    acepta("SELECT * FROM catalogo.artefactos WHERE codigo = 'CREDITO--RETAIL'");
  });
});

describe('guardSql — escritura disfrazada', () => {
  it('rechaza el DML evidente', () => {
    rechaza('DELETE FROM decisiones.ejecuciones', 'SQL_NOT_A_QUERY');
    rechaza('UPDATE catalogo.artefactos SET activo = false', 'SQL_NOT_A_QUERY');
  });

  it('rechaza SELECT … INTO, que es la única escritura con cara de lectura', () => {
    rechaza('SELECT * INTO copia FROM decisiones.ejecuciones', 'SQL_FORBIDDEN_KEYWORD');
  });

  it('rechaza una segunda sentencia encadenada', () => {
    rechaza('SELECT 1; DROP TABLE decision_execution', 'SQL_MULTIPLE_STATEMENTS');
  });

  it('rechaza el DML escondido tras un comentario de línea', () => {
    rechaza(
      'SELECT 1 -- \nUNION SELECT 1; DELETE FROM catalogo.motivos',
      'SQL_MULTIPLE_STATEMENTS',
    );
  });
});

describe('guardSql — el sistema no se nombra', () => {
  it('rechaza los catálogos internos de PostgreSQL', () => {
    rechaza('SELECT * FROM pg_catalog.pg_tables', 'SQL_UNKNOWN_RELATION');
    rechaza('SELECT * FROM information_schema.columns', 'SQL_UNKNOWN_RELATION');
    rechaza('SELECT * FROM pg_class', 'SQL_UNKNOWN_RELATION');
  });

  it('rechaza el mismo nombre entrecomillado, que es como se rodea un filtro de palabras', () => {
    rechaza('SELECT * FROM "pg_class"', 'SQL_FORBIDDEN_NAME');
    rechaza('SELECT * FROM "information_schema"."tables"', 'SQL_FORBIDDEN_NAME');
  });

  it('rechaza alcanzar las tablas base por su esquema real', () => {
    rechaza('SELECT * FROM public.decision_execution', 'SQL_UNKNOWN_RELATION');
  });

  it('rechaza una tabla que no está publicada aunque el dataset sí lo esté', () => {
    rechaza('SELECT * FROM decisiones.credenciales', 'SQL_UNKNOWN_RELATION');
  });
});

describe('guardSql — el tenant no se toca', () => {
  /*
   * El caso más grave de todos: la tenencia entera del módulo descansa en el GUC
   * `app.tenant_id`, que cada vista consulta. Si `set_config` fuera invocable desde el
   * cuadro de texto, una subconsulta podría cambiarlo y toda la aislación caería sin dejar
   * rastro de intrusión — la consulta se vería perfectamente legítima en la bitácora.
   */
  it('rechaza set_config, que reescribiría el tenant de la transacción', () => {
    rechaza(
      "SELECT set_config('app.tenant_id', '99', true), * FROM decisiones.ejecuciones",
      'SQL_FORBIDDEN_FUNCTION',
    );
  });

  it('rechaza current_setting, que delataría la configuración de la sesión', () => {
    rechaza("SELECT current_setting('app.tenant_id')", 'SQL_FORBIDDEN_FUNCTION');
  });

  it('rechaza llamar directamente a la función que resuelve el tenant', () => {
    rechaza('SELECT atlas_current_tenant()', 'SQL_FORBIDDEN_FUNCTION');
  });
});

describe('guardSql — funciones que leen fuera de los datasets', () => {
  it('rechaza leer el sistema de archivos', () => {
    rechaza("SELECT pg_read_file('/etc/passwd')", 'SQL_FORBIDDEN_FUNCTION');
  });

  it('rechaza pg_sleep, con la que se ata una conexión sin consultar nada', () => {
    rechaza('SELECT pg_sleep(30)', 'SQL_FORBIDDEN_FUNCTION');
  });

  it('rechaza una función arbitraria como origen de filas', () => {
    rechaza('SELECT * FROM pg_stat_activity()', 'SQL_FORBIDDEN_FUNCTION');
  });

  it('rechaza delatar el rol de base de datos con el que corre la consola', () => {
    rechaza('SELECT current_user', 'SQL_FORBIDDEN_FUNCTION');
    rechaza('SELECT session_user FROM decisiones.ejecuciones', 'SQL_FORBIDDEN_FUNCTION');
  });
});

describe('guardSql — funciones prohibidas escritas para esquivar la lista', () => {
  const INTERNA = "'select input_snapshot_json from public.decision_execution', true, false, ''";

  it('rechaza query_to_xml entre comillas dobles, que lee cualquier tabla de public', () => {
    rechaza(`SELECT "query_to_xml"(${INTERNA})`, 'SQL_FORBIDDEN_FUNCTION');
  });

  it('rechaza set_config y current_setting entre comillas, que cambian o leen el tenant', () => {
    rechaza(`SELECT "set_config"('app.tenant_id', '2', false)`, 'SQL_FORBIDDEN_FUNCTION');
    rechaza(`SELECT "current_setting"('app.tenant_id')`, 'SQL_FORBIDDEN_FUNCTION');
  });

  it('rechaza el nombre entre comillas aunque el cambio de tenant vaya junto a la lectura', () => {
    rechaza(
      `SELECT "set_config"('app.tenant_id', '2', true), "query_to_xml"(${INTERNA})`,
      'SQL_FORBIDDEN_FUNCTION',
    );
  });

  it('rechaza las variantes en mayúsculas, con y sin comillas', () => {
    rechaza(`SELECT QUERY_TO_XML(${INTERNA})`, 'SQL_FORBIDDEN_FUNCTION');
    rechaza(`SELECT "QUERY_TO_XML"(${INTERNA})`, 'SQL_FORBIDDEN_FUNCTION');
    rechaza(`SELECT "Set_Config"('app.tenant_id', '2', false)`, 'SQL_FORBIDDEN_FUNCTION');
  });

  it('rechaza la función calificada con esquema, con comillas o sin ellas', () => {
    rechaza(`SELECT pg_catalog.query_to_xml(${INTERNA})`, 'SQL_FORBIDDEN_FUNCTION');
    rechaza(`SELECT pg_catalog.set_config('app.tenant_id', '2', false)`, 'SQL_FORBIDDEN_FUNCTION');
    rechaza(`SELECT "pg_catalog"."query_to_xml"(${INTERNA})`, 'SQL_FORBIDDEN_FUNCTION');
    rechaza(
      `SELECT pg_catalog."set_config"('app.tenant_id', '2', false)`,
      'SQL_FORBIDDEN_FUNCTION',
    );
    rechaza(`SELECT public.query_to_xml(${INTERNA})`, 'SQL_FORBIDDEN_FUNCTION');
  });

  it('rechaza las demás funciones que leen fuera de los datasets, entre comillas', () => {
    rechaza(`SELECT "table_to_xml"('public.decision_execution', true, false, '')`);
    rechaza(`SELECT "database_to_xml"(true, false, '')`);
    rechaza(`SELECT "pg_read_file"('/etc/passwd')`);
    rechaza(`SELECT "pg_sleep"(30)`);
    rechaza(`SELECT "dblink"('host=x', 'select 1')`);
    rechaza(`SELECT "atlas_current_tenant"()`);
  });

  it('rechaza las palabras sin paréntesis entre comillas, como "current_user"', () => {
    rechaza('SELECT "current_user"', 'SQL_FORBIDDEN_FUNCTION');
  });

  it('rechaza los identificadores con escapes unicode, que se resuelven en la base', () => {
    rechaza(`SELECT U&"query\\005fto\\005fxml"(${INTERNA})`, 'SQL_UNICODE_ESCAPE');
    rechaza(`SELECT u&"set\\005fconfig"('app.tenant_id', '2', false)`, 'SQL_UNICODE_ESCAPE');
    rechaza(
      'SELECT U&"d!0061t!0061" FROM decisiones.ejecuciones UESCAPE \'!\'',
      'SQL_UNICODE_ESCAPE',
    );
  });

  it('rechaza llamar a cualquier función entre comillas, aunque no esté en la lista', () => {
    rechaza(`SELECT "una_funcion_nueva"(1)`, 'SQL_FORBIDDEN_FUNCTION');
  });

  it('sigue admitiendo alias entre comillas y la lista de columnas de un alias', () => {
    acepta('SELECT estado AS "Estado final" FROM decisiones.ejecuciones');
    acepta('SELECT t."n" FROM generate_series(1, 3) AS "t"("n")');
  });
});

describe('guardSql — el analizador léxico no se engaña con delimitadores', () => {
  it('rechaza las cadenas con dólar, que esconden cualquier carga útil', () => {
    rechaza('SELECT $$ DELETE FROM catalogo.motivos $$', 'SQL_DOLLAR_QUOTED');
  });

  it('cuenta los comentarios de bloque anidados como los cuenta PostgreSQL', () => {
    // Un lector ingenuo cierra el comentario en el primer `*/` y da por comentado lo que
    // la base sí ejecutaría. Aquí el DELETE queda DENTRO del comentario, así que lo que
    // sobrevive es `SELECT 1`, que no nombra ninguna tabla y es una consulta válida.
    acepta('SELECT 1 /* uno /* dos */ DELETE FROM catalogo.motivos */');
  });

  it('rechaza un comentario sin cerrar en vez de intentar adivinar dónde acaba', () => {
    rechaza('SELECT 1 /* sin cerrar', 'SQL_UNTERMINATED');
  });

  it('rechaza un literal sin cerrar', () => {
    rechaza("SELECT * FROM decisiones.ejecuciones WHERE estado = 'APPROVED", 'SQL_UNTERMINATED');
  });
});

describe('guardSql — topes de entrada', () => {
  it('rechaza una sentencia por encima del tope de bytes', () => {
    rechaza(`SELECT '${'x'.repeat(MAX_SQL_BYTES)}'`, 'SQL_TOO_LARGE');
  });

  it('rechaza los caracteres de control, con los que se parte lo que cada lector ve', () => {
    rechaza(`SELECT 1${String.fromCharCode(0)} DROP TABLE x`, 'SQL_INVALID_CHARACTER');
  });

  it('rechaza la consulta vacía', () => {
    rechaza('   ', 'SQL_EMPTY');
  });
});

describe('guardSql — lo que informa al llamante', () => {
  it('devuelve las relaciones del catálogo que la consulta nombra', () => {
    const result = guardSql(
      `
      SELECT * FROM decisiones.ejecuciones e
      JOIN desenlaces.observaciones o ON o.ejecucion_id = e.ejecucion_id
    `,
      CATALOGO,
    );
    expect([...result.relations].sort()).toEqual([
      'decisiones.ejecuciones',
      'desenlaces.observaciones',
    ]);
  });

  it('señala la línea del problema, para poder subrayarla en el editor', () => {
    const result = guardSql(
      'SELECT *\nFROM decisiones.ejecuciones\nWHERE 1 = 1;\nDROP TABLE x',
      CATALOGO,
    );
    expect(result.violations[0]?.line).toBeGreaterThan(1);
  });
});
