#!/usr/bin/env node
/**
 * Aprovisionamiento idempotente de los roles PostgreSQL de lectura y escritura.
 *
 * Crea (o corrige) `atlas_writer` y `atlas_reader` con mínimo privilegio, aplica los
 * permisos sobre los objetos que ya existen, configura los privilegios predeterminados
 * para los que se creen después y VERIFICA el resultado consultando al motor. Reejecutarlo
 * no duplica nada ni acumula permisos.
 *
 * Por qué no basta con `docker-entrypoint-initdb.d`: esos scripts corren solo cuando se
 * crea el volumen por primera vez. Una base que ya existe —la habitual en desarrollo— no
 * los vuelve a ver nunca, así que el aprovisionamiento tiene que ser un comando explícito.
 *
 * Uso:
 *   yarn db:provision:dev
 *
 * Variables (ver .env.example):
 *   POSTGRES_ADMIN_URL | ADMIN_DATABASE_URL | DATABASE_URL   conexión administrativa
 *   POSTGRES_WRITER_ROLE      (def. atlas_writer)
 *   POSTGRES_READER_ROLE      (def. atlas_reader)
 *   POSTGRES_WRITER_PASSWORD  obligatoria, >= 16 caracteres
 *   POSTGRES_READER_PASSWORD  obligatoria, >= 16 caracteres
 *   POSTGRES_MANAGED_SCHEMAS  (def. public) lista separada por comas
 *   POSTGRES_OBJECT_OWNER_ROLE  rol que crea los objetos (def. el usuario administrativo)
 *
 * NUNCA se ejecuta en producción: allí el aprovisionamiento va por IaC con credenciales de
 * un gestor de secretos y cambios auditables (§26).
 */
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

/** Carga .env sin depender de dotenv, igual que el resto de scripts del repositorio. */
function loadDotEnv() {
  try {
    for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, '');
    }
  } catch {
    /* sin .env se usan solo las variables ya presentes en el entorno */
  }
}

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

/**
 * Toda sentencia DDL se construye con `format('%I' / '%L')` EN EL SERVIDOR y con
 * parámetros enlazados: es el propio Postgres quien entrecomilla el identificador y el
 * literal. Concatenar aquí sería el camino corto a una inyección en el script que existe
 * precisamente para endurecer la base.
 */
async function ddl(client, template, values) {
  const { rows } = await client.query(
    `SELECT format(${template}) AS stmt`,
    values,
  );
  await client.query(rows[0].stmt);
}

function readConfig() {
  loadDotEnv();
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (nodeEnv === 'production') {
    fail(
      'Refusing to run in production. Provision roles through infrastructure-as-code with ' +
        'credentials from a secret manager (docs/data/postgres-provisioning.md).',
    );
  }

  const adminUrl =
    process.env.POSTGRES_ADMIN_URL ?? process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!adminUrl) fail('POSTGRES_ADMIN_URL, ADMIN_DATABASE_URL or DATABASE_URL is required.');

  const writer = process.env.POSTGRES_WRITER_ROLE ?? 'atlas_writer';
  const reader = process.env.POSTGRES_READER_ROLE ?? 'atlas_reader';
  for (const [name, role] of [
    ['POSTGRES_WRITER_ROLE', writer],
    ['POSTGRES_READER_ROLE', reader],
  ]) {
    if (!IDENTIFIER.test(role)) fail(`${name}="${role}" is not a valid PostgreSQL role name.`);
  }
  if (writer === reader) fail('The writer and reader roles must be different.');

  const writerPassword = process.env.POSTGRES_WRITER_PASSWORD;
  const readerPassword = process.env.POSTGRES_READER_PASSWORD;
  for (const [name, secret] of [
    ['POSTGRES_WRITER_PASSWORD', writerPassword],
    ['POSTGRES_READER_PASSWORD', readerPassword],
  ]) {
    if (!secret || secret.length < 16) fail(`${name} is required and must be at least 16 characters.`);
  }
  if (writerPassword === readerPassword) {
    fail('The writer and reader passwords must be different; separate credentials are the point.');
  }

  const schemas = (process.env.POSTGRES_MANAGED_SCHEMAS ?? 'public')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!schemas.length) fail('POSTGRES_MANAGED_SCHEMAS must list at least one schema.');
  for (const schema of schemas) {
    if (!IDENTIFIER.test(schema)) fail(`POSTGRES_MANAGED_SCHEMAS contains an invalid schema "${schema}".`);
  }

  return { adminUrl, writer, reader, writerPassword, readerPassword, schemas };
}

/** Crea el rol si falta y corrige SIEMPRE sus atributos: un rol preexistente puede venir mal. */
async function ensureRole(client, role, password) {
  const { rows } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  const created = rows.length === 0;
  if (created) {
    await ddl(client, `'CREATE ROLE %I LOGIN', $1::text`, [role]);
  }
  // Se reaplican en cada corrida a propósito: si alguien concedió SUPERUSER o BYPASSRLS a
  // mano, volver a ejecutar el aprovisionamiento debe deshacerlo, no respetarlo.
  await ddl(
    client,
    `'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT', $1::text`,
    [role],
  );
  await ddl(client, `'ALTER ROLE %I WITH PASSWORD %L', $1::text, $2::text`, [role, password]);
  return created;
}

async function grantPrivileges(client, { writer, reader, schemas, database, owner }) {
  for (const role of [writer, reader]) {
    await ddl(client, `'GRANT CONNECT ON DATABASE %I TO %I', $1::text, $2::text`, [database, role]);
  }

  for (const schema of schemas) {
    for (const role of [writer, reader]) {
      await ddl(client, `'GRANT USAGE ON SCHEMA %I TO %I', $1::text, $2::text`, [schema, role]);
    }

    // El lector se limpia primero: si en una corrida anterior tuvo DML —o si alguien se lo
    // concedió a mano— revocarlo antes de conceder SELECT deja el estado final correcto sin
    // depender de cómo estaba al empezar.
    await ddl(
      client,
      `'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA %I FROM %I', $1::text, $2::text`,
      [schema, reader],
    );
    await ddl(
      client,
      `'REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', $1::text, $2::text`,
      [schema, reader],
    );
    await ddl(client, `'GRANT SELECT ON ALL TABLES IN SCHEMA %I TO %I', $1::text, $2::text`, [
      schema,
      reader,
    ]);

    await ddl(
      client,
      `'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO %I', $1::text, $2::text`,
      [schema, writer],
    );
    await ddl(
      client,
      `'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO %I', $1::text, $2::text`,
      [schema, writer],
    );

    // Privilegios predeterminados: dependen del rol QUE CREA los objetos, por eso llevan
    // `FOR ROLE`. Sin esto, la tabla de la próxima migración nace invisible para ambos.
    await ddl(
      client,
      `'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', $1::text, $2::text, $3::text`,
      [owner, schema, writer],
    );
    await ddl(
      client,
      `'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT ON TABLES TO %I', $1::text, $2::text, $3::text`,
      [owner, schema, reader],
    );
    await ddl(
      client,
      `'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO %I', $1::text, $2::text, $3::text`,
      [owner, schema, writer],
    );
  }

  // La cadena de auditoría es append-only: el escritor inserta pero jamás modifica ni
  // borra. Refuerza los disparadores que ya existen y espeja lo que la migración
  // 20260719080000 hace con `atlas_app`.
  const { rows } = await client.query(
    `SELECT schemaname FROM pg_tables WHERE schemaname = ANY($1::text[]) AND tablename = 'decision_audit_event'`,
    [schemas],
  );
  for (const row of rows) {
    await ddl(
      client,
      `'REVOKE UPDATE, DELETE, TRUNCATE ON %I.%I FROM %I', $1::text, 'decision_audit_event', $2::text`,
      [row.schemaname, writer],
    );
  }
}

/**
 * Verificación real contra el motor: no se declara nada «aplicado» por haber ejecutado el
 * GRANT, se pregunta si el privilegio existe.
 */
async function verify(client, { writer, reader, schemas }) {
  const { rows } = await client.query(
    `
    WITH tables AS (
      SELECT schemaname || '.' || quote_ident(tablename) AS ref
      FROM pg_tables WHERE schemaname = ANY($1::text[])
    )
    SELECT
      (SELECT count(*) FROM tables WHERE has_table_privilege($2, ref, 'SELECT'))::int AS writer_select,
      (SELECT count(*) FROM tables WHERE has_table_privilege($2, ref, 'INSERT'))::int AS writer_insert,
      (SELECT count(*) FROM tables WHERE has_table_privilege($3, ref, 'SELECT'))::int AS reader_select,
      (SELECT count(*) FROM tables WHERE has_table_privilege($3, ref, 'INSERT')
         OR has_table_privilege($3, ref, 'UPDATE')
         OR has_table_privilege($3, ref, 'DELETE'))::int AS reader_write,
      (SELECT count(*) FROM tables)::int AS total_tables,
      (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls FROM pg_roles WHERE rolname = $2) AS writer_privileged,
      (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls FROM pg_roles WHERE rolname = $3) AS reader_privileged
    `,
    [schemas, writer, reader],
  );
  return rows[0];
}

async function main() {
  const config = readConfig();
  const client = new Client({ connectionString: config.adminUrl });
  await client.connect();

  try {
    const { rows: session } = await client.query(
      'SELECT current_database() AS database, current_user AS "user"',
    );
    const database = session[0].database;
    const owner = process.env.POSTGRES_OBJECT_OWNER_ROLE ?? session[0].user;
    if (!IDENTIFIER.test(owner)) fail(`POSTGRES_OBJECT_OWNER_ROLE="${owner}" is not a valid role name.`);

    const writerCreated = await ensureRole(client, config.writer, config.writerPassword);
    const readerCreated = await ensureRole(client, config.reader, config.readerPassword);
    await grantPrivileges(client, { ...config, database, owner });
    const report = await verify(client, config);

    // Resumen saneado: nombres de rol y recuentos. Ni URLs, ni contraseñas, ni host.
    console.log('PostgreSQL development roles provisioned');
    console.log(`  database              ${database}`);
    console.log(`  managed schemas       ${config.schemas.join(', ')}`);
    console.log(`  object owner          ${owner}`);
    console.log(`  tables in scope       ${report.total_tables}`);
    console.log(
      `  ${config.writer.padEnd(20)}${writerCreated ? 'created' : 'already present'} · SELECT ${report.writer_select} · INSERT ${report.writer_insert}`,
    );
    console.log(
      `  ${config.reader.padEnd(20)}${readerCreated ? 'created' : 'already present'} · SELECT ${report.reader_select} · write ${report.reader_write}`,
    );

    const problems = [];
    if (report.writer_privileged) problems.push(`${config.writer} holds administrative attributes`);
    if (report.reader_privileged) problems.push(`${config.reader} holds administrative attributes`);
    if (report.reader_write > 0) {
      problems.push(`${config.reader} can still write to ${report.reader_write} table(s)`);
    }
    if (report.total_tables > 0 && report.writer_insert === 0) {
      problems.push(`${config.writer} cannot insert into any table`);
    }
    if (problems.length) {
      for (const problem of problems) console.error(`✖ ${problem}`);
      process.exit(1);
    }
    console.log('✔ Least-privilege verification passed');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  // El mensaje del driver puede llevar host y usuario; se emite solo el motivo.
  console.error(`✖ Provisioning failed: ${error.message}`);
  process.exit(1);
});
