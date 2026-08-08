import { Client } from 'pg';

/**
 * Regresión del defecto que hacía fallar de forma intermitente a los trabajos de fondo.
 *
 * `applyTenantRls` envuelve las operaciones de modelo y `$transaction`, pero **una sentencia
 * cruda suelta cae al cliente base** y no fija `app.tenant_id`. La política de las tablas
 * tenant-scoped dice
 *
 *   current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting(...)::bigint
 *
 * y ahí está la trampa: `set_config(..., true)` es LOCAL a la transacción, pero una vez que
 * una conexión la ha usado, el parámetro queda DEFINIDO con cadena vacía en la sesión. Ya no
 * es NULL, así que la política intenta `''::bigint` y aborta con 22P02. Como el relay del
 * outbox y las purgas comparten pool con el tráfico de peticiones cuando `WORKER_ROLE=ALL`
 * —el valor por defecto—, el fallo aparecía o no según qué conexión tocara, y el orquestador
 * lo enterraba bajo un backoff exponencial.
 *
 * Esta prueba fija el comportamiento de la BASE DE DATOS, que es lo que no puede cambiar sin
 * que nos enteremos: reproduce la contaminación del GUC y comprueba que la forma correcta
 * —la sentencia dentro de una transacción que fija el tenant— sí funciona sobre esa misma
 * conexión ya contaminada. Los servicios que la aplican están en
 * `outbox-relay.service.ts`, `retention-sweeper.service.ts`, los dos `*-run-worker` y
 * `prisma-budget.repository.ts`.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

/** Tenant-scoped y con RLS FORZADA; es la tabla que reclama el relay del outbox. */
const TABLE = 'decision_outbox_event';

describeDb('Contaminación del GUC de tenant en consultas crudas (integration)', () => {
  const client = new Client({ connectionString: DATABASE_URL });

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  afterEach(async () => {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.query('RESET ROLE').catch(() => undefined);
  });

  it('la tabla del outbox tiene RLS habilitada Y forzada', async () => {
    const { rows } = await client.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
      [TABLE],
    );
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('una conexión que ya sirvió a un tenant deja app.tenant_id definido como cadena vacía', async () => {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', '1', true)`);
    await client.query('COMMIT');

    const { rows } = await client.query(
      `SELECT current_setting('app.tenant_id', true) AS value,
              current_setting('app.tenant_id', true) IS NULL AS is_null`,
    );
    // Éste es el hecho del que depende todo lo demás: NO vuelve a NULL.
    expect(rows[0].value).toBe('');
    expect(rows[0].is_null).toBe(false);
  });

  it('sobre esa conexión, una sentencia cruda SUELTA aborta con 22P02', async () => {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', '1', true)`);
    await client.query('COMMIT');
    // El rol de aplicación es NOSUPERUSER: para un superusuario la RLS es inerte y el
    // defecto no se observaría.
    await client.query('SET ROLE atlas_app');

    await expect(client.query(`SELECT count(*) FROM ${TABLE}`)).rejects.toMatchObject({
      code: '22P02',
    });
  });

  it('la MISMA sentencia dentro de una transacción que fija el tenant sí funciona', async () => {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', '1', true)`);
    await client.query('COMMIT');
    await client.query('SET ROLE atlas_app');

    // Exactamente lo que hace el Proxy de `applyTenantRls` para `$transaction`: anteponer
    // el `set_config` dentro de la misma transacción que la sentencia.
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', '1', true)`);
    const { rows } = await client.query(`SELECT count(*)::int AS total FROM ${TABLE}`);
    await client.query('COMMIT');

    expect(typeof rows[0].total).toBe('number');
  });

  it('una conexión NUEVA sí atiende la sentencia suelta, y la contaminación no se puede deshacer', async () => {
    // El caso del proceso worker dedicado (`WORKER_ROLE=WORKER`): nunca fija tenant, el GUC
    // es NULL de verdad y la política deja pasar. Es la razón por la que el defecto no se
    // veía en las topologías de producción publicadas, sólo con `WORKER_ROLE=ALL`.
    const fresh = new Client({ connectionString: DATABASE_URL });
    await fresh.connect();
    try {
      await fresh.query('SET ROLE atlas_app');
      const { rows } = await fresh.query(`SELECT count(*)::int AS total FROM ${TABLE}`);
      expect(typeof rows[0].total).toBe('number');

      // Y una vez contaminada, NO hay vuelta atrás dentro de la misma sesión: `RESET` sobre
      // un parámetro personalizado que nunca se fijó a nivel de sesión no lo devuelve a
      // NULL. Es decir, la conexión queda inservible para sentencias crudas durante toda su
      // vida en el pool — por eso el fallo, una vez que aparecía, era persistente para esa
      // conexión y no un parpadeo aislado.
      await fresh.query('BEGIN');
      await fresh.query(`SELECT set_config('app.tenant_id', '1', true)`);
      await fresh.query('COMMIT');
      await fresh.query(`RESET "app.tenant_id"`).catch(() => undefined);
      await expect(fresh.query(`SELECT count(*) FROM ${TABLE}`)).rejects.toMatchObject({
        code: '22P02',
      });
    } finally {
      await fresh.end();
    }
  });
});
