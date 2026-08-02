import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

/**
 * Plan §2.6: proves the tenant RLS policies actually isolate at the database level, as
 * defense in depth behind the application's own tenant filtering. Runs everything inside a
 * transaction that is rolled back, and impersonates the non-superuser app role with SET
 * ROLE (a superuser bypasses RLS, so the policy can only be observed as a non-super role).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('Tenant RLS isolation (integration)', () => {
  const client = new Client({ connectionString: DATABASE_URL });
  const A = 700001;
  const B = 700002;

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  async function withNonSuperRole<T>(fn: () => Promise<T>): Promise<T> {
    // Everything happens in one transaction we always roll back, so no test data persists
    // and the append-only audit table is never actually mutated.
    await client.query('BEGIN');
    try {
      // Seed two tenants as the elevated role (RLS is bypassed for a superuser).
      // updated_at is NOT NULL with no default (Prisma sets it on write; raw SQL must too).
      await client.query(
        `INSERT INTO decision_artifact (tenant_id, artifact_code, artifact_type, name, owner_team, business_purpose, risk_domain, updated_at)
         VALUES ($1,'RLS_A','CREDIT_POLICY','A','team','p','dom',now()), ($2,'RLS_B','CREDIT_POLICY','B','team','p','dom',now())`,
        [A, B],
      );
      // Become the non-superuser runtime role for the rest of the transaction.
      await client.query('SET ROLE atlas_app');
      return await fn();
    } finally {
      // A blocked INSERT aborts the transaction, so end it before anything else. Both are
      // tolerant: after ROLLBACK the session is clean and RESET ROLE can run.
      await client.query('ROLLBACK').catch(() => undefined);
      await client.query('RESET ROLE').catch(() => undefined);
    }
  }

  async function countFor(tenantId: number | null): Promise<number> {
    if (tenantId === null) {
      await client.query(`SELECT set_config('app.tenant_id', '', true)`);
    } else {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [String(tenantId)]);
    }
    const res = await client.query(
      `SELECT count(*)::int n FROM decision_artifact WHERE artifact_code IN ('RLS_A','RLS_B')`,
    );
    return res.rows[0].n;
  }

  it("shows a tenant only its own rows and never another tenant's", async () => {
    await withNonSuperRole(async () => {
      expect(await countFor(A)).toBe(1); // only RLS_A
      expect(await countFor(B)).toBe(1); // only RLS_B
      // Prove it is genuinely filtered, not just counting: fetch the codes for tenant A.
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [String(A)]);
      const rows = await client.query(
        `SELECT artifact_code FROM decision_artifact WHERE artifact_code IN ('RLS_A','RLS_B')`,
      );
      expect(rows.rows.map((r) => r.artifact_code)).toEqual(['RLS_A']);
    });
  });

  it('allows the query when no tenant context is set (auth/health/migrations path)', async () => {
    await withNonSuperRole(async () => {
      // Both seeded rows are visible without a context, so context-less paths never break.
      expect(await countFor(null)).toBe(2);
    });
  });

  it('blocks inserting a row for a different tenant than the active context (WITH CHECK)', async () => {
    await withNonSuperRole(async () => {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [String(A)]);
      await expect(
        client.query(
          `INSERT INTO decision_artifact (tenant_id, artifact_code, artifact_type, name, owner_team, business_purpose, risk_domain, updated_at)
           VALUES ($1,'RLS_EVIL','CREDIT_POLICY','x','team','p','dom',now())`,
          [B],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  /**
   * `yarn migration:validate` answers this question by grepping the migration SQL, which
   * means it can only see the statements it knows how to spell: six tables protected through
   * a `DO $$ ... EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target)` loop
   * were reported as unprotected while the database had them enabled, forced and policied.
   * The catalog is the authority, so ask it directly — this passes or fails on what is
   * actually true of the database, not on how the migration happened to be written.
   */
  it('has RLS enabled, forced and policied on every tenant-scoped table', async () => {
    const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    const tenantTables: string[] = [];
    for (const model of schema.matchAll(/^model\s+\w+\s*\{([\s\S]*?)^\}/gm)) {
      const body = model[1];
      if (!/^\s+tenantId\s+.*@map\("tenant_id"\)/m.test(body)) continue;
      const mapped = body.match(/@@map\("([^"]+)"\)/);
      if (mapped) tenantTables.push(mapped[1]);
    }
    expect(tenantTables.length).toBeGreaterThan(0);

    const state = await client.query<{
      relname: string;
      enabled: boolean;
      forced: boolean;
      policies: number;
    }>(
      `SELECT c.relname,
              c.relrowsecurity AS enabled,
              c.relforcerowsecurity AS forced,
              (SELECT count(*)::int FROM pg_policies p
                WHERE p.schemaname = 'public' AND p.tablename = c.relname
                  AND p.policyname = 'tenant_isolation') AS policies
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
      [tenantTables],
    );
    expect(state.rows.map((row) => row.relname).sort()).toEqual([...tenantTables].sort());
    expect(
      state.rows
        .filter((row) => !row.enabled || !row.forced || row.policies !== 1)
        .map((row) => row.relname),
    ).toEqual([]);
  });
});
