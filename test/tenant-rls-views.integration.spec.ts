import { Client } from 'pg';

/**
 * Plan §2.6 follow-up: tenant-scoped views must not leak across tenants. A view without
 * security_invoker runs with its (superuser) owner's rights and bypasses RLS on the base
 * tables, so the runtime role would see every tenant through the view. These guard that
 * every tenant view keeps security_invoker on, and prove the isolation as the non-super role.
 */
const DATABASE_URL = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('Tenant RLS through views (integration)', () => {
  const client = new Client({ connectionString: DATABASE_URL });

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it('has security_invoker on for every tenant-scoped view (guards new views too)', async () => {
    const { rows } = await client.query(`
      SELECT c.relname,
             (SELECT option_value FROM pg_options_to_table(c.reloptions)
               WHERE option_name = 'security_invoker') AS security_invoker
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind = 'v'
         AND n.nspname = 'public'
         AND EXISTS (
           SELECT 1 FROM information_schema.columns col
            WHERE col.table_schema = 'public'
              AND col.table_name = c.relname
              AND col.column_name = 'tenant_id')
    `);
    expect(rows.length).toBeGreaterThan(0);
    const unprotected = rows
      .filter((r) => (r.security_invoker ?? 'off') !== 'on')
      .map((r) => r.relname);
    expect(unprotected).toEqual([]);
  });

  it("does not leak another tenant's rows through a view for the runtime role", async () => {
    await client.query('SET ROLE atlas_app');
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', '999999', true)`);
      const foreign = await client.query('SELECT count(*)::int n FROM vw_form_option');
      expect(foreign.rows[0].n).toBe(0);

      await client.query(`SELECT set_config('app.tenant_id', '1', true)`);
      const own = await client.query('SELECT count(*)::int n FROM vw_form_option');
      expect(own.rows[0].n).toBeGreaterThan(0);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.query('RESET ROLE').catch(() => undefined);
    }
  });
});
