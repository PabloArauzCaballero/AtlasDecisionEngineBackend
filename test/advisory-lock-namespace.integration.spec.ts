import { Client } from 'pg';
import { AdvisoryLockDomain, advisoryLockKey } from '../src/common/prisma/advisory-lock';
import { uniqueTenantId } from './support/unique-tenant';

/**
 * `pg_advisory_lock` has ONE 64-bit key space for the whole database, so two domains that
 * compute the same number block each other for no reason. The three families this service
 * uses were derived from raw identifiers that can collide: the audit chain used `tenantId`
 * verbatim, deployments used `(artifactId << 32) ^ environmentId` — values from 2^32 up —
 * and seeding used the constant 46262026. Tenant ids here are not small (the test generator
 * already produces 17-digit values), so a tenant's audit chain landing on a deployment's key
 * was reachable, and the symptom would be a performance mystery: deployments of one artifact
 * serializing against an unrelated tenant's decisions.
 *
 * The keys go to Postgres, so the properties that matter are asserted against Postgres.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describe('advisoryLockKey', () => {
  it('separa dominios que comparten el mismo identificador', () => {
    const id = 42n;
    const keys = new Set([
      advisoryLockKey(AdvisoryLockDomain.AuditChain, id).toString(),
      advisoryLockKey(AdvisoryLockDomain.Deployment, id).toString(),
      advisoryLockKey(AdvisoryLockDomain.Seeding, id).toString(),
    ]);
    expect(keys.size).toBe(3);
  });

  it('es estable: la misma entrada da siempre la misma clave', () => {
    expect(advisoryLockKey(AdvisoryLockDomain.AuditChain, 7n)).toBe(
      advisoryLockKey(AdvisoryLockDomain.AuditChain, 7n),
    );
  });

  it('distingue el orden de las partes', () => {
    expect(advisoryLockKey(AdvisoryLockDomain.Deployment, 1n, 2n)).not.toBe(
      advisoryLockKey(AdvisoryLockDomain.Deployment, 2n, 1n),
    );
  });

  it('no colisiona sobre un rango realista de tenants y despliegues', () => {
    const keys = new Set<string>();
    for (let i = 0n; i < 500n; i += 1n) {
      keys.add(advisoryLockKey(AdvisoryLockDomain.AuditChain, 11785452278211804n + i).toString());
      keys.add(advisoryLockKey(AdvisoryLockDomain.Deployment, i, 1n).toString());
      keys.add(advisoryLockKey(AdvisoryLockDomain.Deployment, i, 2n).toString());
    }
    expect(keys.size).toBe(1_500);
  });
});

describeDb('advisoryLockKey contra PostgreSQL (integration)', () => {
  const holder = new Client({ connectionString: DATABASE_URL });
  const contender = new Client({ connectionString: DATABASE_URL });

  beforeAll(async () => {
    await holder.connect();
    await contender.connect();
  });

  afterEach(async () => {
    // Cada caso se limpia solo. Dejar la transacción del holder abierta entre casos hacía
    // que el segundo dependiera del primero, y en la suite completa eso se traducía en un
    // fallo que no reproducía en aislamiento.
    await contender.query('ROLLBACK').catch(() => undefined);
    await holder.query('ROLLBACK').catch(() => undefined);
  });

  afterAll(async () => {
    await holder.end();
    await contender.end();
  });

  // Irrepetible entre ejecuciones y procesos: `AuditService` ya toma la clave de este
  // dominio en cada escritura auditada, así que un id fijo podía chocar con otra suite.
  const tenantId = uniqueTenantId(9);
  const auditKey = advisoryLockKey(AdvisoryLockDomain.AuditChain, tenantId);

  it('cabe en el bigint con signo de Postgres y se puede tomar', async () => {
    await holder.query('BEGIN');
    // Si la clave desbordara los 64 bits con signo, esto fallaría al enviarse.
    await holder.query('SELECT pg_advisory_xact_lock($1)', [auditKey.toString()]);
    const held = await holder.query(
      `SELECT count(*)::int n FROM pg_locks WHERE locktype = 'advisory'
        AND ((classid::bigint << 32) | objid::bigint) = $1::bigint AND granted`,
      [auditKey.toString()],
    );
    expect(held.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it('una sesión que toma la clave de otro dominio no espera a la de auditoría', async () => {
    await holder.query('BEGIN');
    await holder.query('SELECT pg_advisory_xact_lock($1)', [auditKey.toString()]);

    // pg_try_advisory_xact_lock no bloquea: devuelve false si la clave ya está tomada, que
    // es exactamente lo que pasaría si los dominios compartieran espacio de claves.
    await contender.query('BEGIN');
    for (const key of [
      advisoryLockKey(AdvisoryLockDomain.Deployment, tenantId, 1n),
      advisoryLockKey(AdvisoryLockDomain.Seeding, tenantId),
    ]) {
      const acquired = await contender.query('SELECT pg_try_advisory_xact_lock($1) AS ok', [
        key.toString(),
      ]);
      expect(acquired.rows[0].ok).toBe(true);
    }
    // Y sobre la MISMA clave sí compite, que es la serialización que la cadena necesita.
    const sameKey = await contender.query('SELECT pg_try_advisory_xact_lock($1) AS ok', [
      auditKey.toString(),
    ]);
    expect(sameKey.rows[0].ok).toBe(false);
  });
});
