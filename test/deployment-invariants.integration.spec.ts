import { Client } from 'pg';

/**
 * Plan §2.8 / D-10: database-level invariants the runtime relies on. Everything runs in a
 * transaction that is rolled back, so no data persists.
 */
const DATABASE_URL = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('Deployment invariants and range checks (integration)', () => {
  const client = new Client({ connectionString: DATABASE_URL });

  beforeAll(async () => {
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
  });

  async function expectRejected(sql: string, code: string): Promise<void> {
    await client.query('BEGIN');
    try {
      await expect(client.query(sql)).rejects.toMatchObject({ code });
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
    }
  }

  it('allows at most one active deployment per (artifact version, environment)', async () => {
    const active = await client.query(
      `SELECT artifact_version_id, compiled_artifact_id, environment_id
         FROM decision_deployment WHERE is_active = true LIMIT 1`,
    );
    if (!active.rows.length) return; // nothing to duplicate in this database
    const d = active.rows[0];
    await expectRejected(
      `INSERT INTO decision_deployment
         (artifact_version_id, compiled_artifact_id, environment_id, deployment_mode, deployment_status, effective_from, is_active, deployed_by)
       VALUES (${d.artifact_version_id}, ${d.compiled_artifact_id}, ${d.environment_id}, 'FULL', 'ACTIVE', now(), true, 'x')`,
      '23505',
    );
  });

  it('rejects a traffic percentage outside 0..100', async () => {
    const dep = await client.query('SELECT id FROM decision_deployment LIMIT 1');
    if (!dep.rows.length) return;
    await expectRejected(
      `INSERT INTO decision_deployment_traffic (deployment_id, segment_key, traffic_percentage, priority)
       VALUES (${dep.rows[0].id}, 'chk-range', 150, 1)`,
      '23514',
    );
  });

  it('rejects a negative routing priority', async () => {
    const dep = await client.query('SELECT id FROM decision_deployment LIMIT 1');
    if (!dep.rows.length) return;
    await expectRejected(
      `INSERT INTO decision_deployment_traffic (deployment_id, segment_key, traffic_percentage, priority)
       VALUES (${dep.rows[0].id}, 'chk-prio', 50, -1)`,
      '23514',
    );
  });

  it('rejects a coverage percentage outside 0..100', async () => {
    const run = await client.query('SELECT id FROM decision_test_run LIMIT 1');
    if (!run.rows.length) return;
    await expectRejected(
      `INSERT INTO decision_test_coverage (test_run_id, coverage_type, covered_count, total_count, coverage_percentage)
       VALUES (${run.rows[0].id}, 'chk', 1, 1, 250)`,
      '23514',
    );
  });
});
