import { Client } from 'pg';

/**
 * Privilegios REALES de los roles de lectura y escritura.
 *
 * No basta con inspeccionar los GRANT: lo que importa es si una escritura con el rol
 * lector falla de verdad. Aquí se ejecutan operaciones contra la base y se exige el
 * rechazo, que es la única evidencia que vale.
 *
 * Requiere que `yarn db:provision:dev` (o el servicio `provision-db-roles` de Compose)
 * haya corrido y que el entorno declare las dos conexiones:
 *
 *   DATABASE_WRITE_URL=postgresql://atlas_writer:...@host:5432/atlas_decision?schema=public
 *   DATABASE_READ_URL=postgresql://atlas_reader:...@host:5432/atlas_decision?schema=public
 *
 * Sin ellas la suite se salta: el dato externo que falta son esas dos credenciales
 * aprovisionadas, y bloquear el resto de la batería por eso sería peor que declararlo.
 */
const WRITE_URL = process.env.DATABASE_WRITE_URL;
const READ_URL = process.env.DATABASE_READ_URL;
const separated = Boolean(WRITE_URL && READ_URL && WRITE_URL !== READ_URL);
const describeRoles = separated ? describe : describe.skip;

/** Tabla neutra: existe en todo despliegue migrado y no forma parte de la cadena append-only. */
const TABLE = 'decision_environment';

describeRoles('PostgreSQL reader and writer privileges (integration)', () => {
  let writer: Client;
  let reader: Client;

  beforeAll(async () => {
    writer = new Client({ connectionString: WRITE_URL });
    reader = new Client({ connectionString: READ_URL });
    await writer.connect();
    await reader.connect();
  });

  afterAll(async () => {
    await writer.end();
    await reader.end();
  });

  it('connects with two different database roles', async () => {
    const { rows: writerRows } = await writer.query('SELECT current_user AS role');
    const { rows: readerRows } = await reader.query('SELECT current_user AS role');

    expect(writerRows[0].role).not.toBe(readerRows[0].role);
  });

  it('neither role is a superuser, and neither can bypass RLS', async () => {
    for (const client of [writer, reader]) {
      const { rows } = await client.query(
        `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
         FROM pg_roles WHERE rolname = current_user`,
      );
      // Un superusuario salta toda política de RLS: bastaría uno para anular el
      // aislamiento por tenant de la plataforma entera.
      expect(rows[0]).toMatchObject({
        rolsuper: false,
        rolbypassrls: false,
        rolcreatedb: false,
        rolcreaterole: false,
      });
    }
  });

  it('lets the reader select', async () => {
    await expect(reader.query(`SELECT count(*) FROM ${TABLE}`)).resolves.toBeDefined();
  });

  it('lets the writer select and write', async () => {
    await writer.query('BEGIN');
    try {
      const { rows } = await writer.query(
        `INSERT INTO ${TABLE} (code, name, environment_type, is_production)
         VALUES ($1, $2, $3, false) RETURNING id`,
        [`PRIV_PROBE_${Date.now()}`, 'privilege probe', 'TEST'],
      );
      expect(rows[0].id).toBeDefined();
      await writer.query(`UPDATE ${TABLE} SET name = $1 WHERE id = $2`, [
        'privilege probe updated',
        rows[0].id,
      ]);
    } finally {
      // Se deshace siempre: esta prueba comprueba permisos, no deja datos.
      await writer.query('ROLLBACK');
    }
  });

  it.each([
    [
      'INSERT',
      `INSERT INTO ${TABLE} (code, name, environment_type, is_production)
       VALUES ('READER_SHOULD_FAIL', 'nope', 'TEST', false)`,
    ],
    ['UPDATE', `UPDATE ${TABLE} SET name = 'nope'`],
    ['DELETE', `DELETE FROM ${TABLE}`],
    ['TRUNCATE', `TRUNCATE ${TABLE}`],
    ['CREATE', 'CREATE TABLE reader_should_fail (id int)'],
  ])('rejects %s from the reader', async (_operation, statement) => {
    // 42501 = insufficient_privilege. Se exige el código, no solo que falle: un fallo por
    // sintaxis o por columna inexistente daría un verde falso.
    await expect(reader.query(statement)).rejects.toMatchObject({ code: '42501' });
  });

  it('keeps the audit chain append-only even for the writer', async () => {
    await expect(
      writer.query(`UPDATE decision_audit_event SET actor_id = 'tampered'`),
    ).rejects.toBeDefined();
  });
});
