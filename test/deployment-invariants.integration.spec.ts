import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { DeploymentResolverService } from '../src/modules/deployments/deployment-resolver.service';

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

  it('stops resolving a suspended deployment even while the binding still points to it', async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
    const rollback = new Error('rollback test transaction');
    // Its own fixture, inside the transaction: CI runs this suite against a migrated, EMPTY
    // database, and a test that waits for a seeded binding there either fails or skips green.
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const tenantId = 900_000_000n + BigInt(Math.floor(Math.random() * 1e6));
    const artifactCode = `IT_SUSPENDED_${suffix}`;
    const environmentCode = `IT_${suffix}`.slice(0, 40);
    try {
      await expect(
        prisma.$transaction(async (tx) => {
          const environment = await tx.decisionEnvironment.create({
            data: { code: environmentCode, name: 'Integration', environmentType: 'TEST' },
          });
          const artifact = await tx.decisionArtifact.create({
            data: {
              tenantId,
              artifactCode,
              artifactType: 'DECISION_FLOW',
              name: 'Suspended deployment fixture',
              ownerTeam: 'risk',
              businessPurpose: 'Integration fixture',
              riskDomain: 'CREDIT',
            },
          });
          const version = await tx.decisionArtifactVersion.create({
            data: {
              artifactId: artifact.id,
              versionNumber: 1,
              semanticVersion: '1.0.0',
              status: 'DEPLOYED_TO_TEST',
              createdBy: 'integration-test',
            },
          });
          const compiled = await tx.decisionCompiledArtifact.create({
            data: {
              artifactVersionId: version.id,
              compilerVersion: 'it',
              runtimeSchemaVersion: 'it',
              compiledPayloadJson: {},
              compiledChecksum: `it-${suffix}`,
              compileStatus: 'SUCCESS',
            },
          });
          const deployment = await tx.decisionDeployment.create({
            data: {
              artifactVersionId: version.id,
              compiledArtifactId: compiled.id,
              environmentId: environment.id,
              deploymentMode: 'FULL',
              deploymentStatus: 'ACTIVE',
              effectiveFrom: new Date(Date.now() - 60_000),
              isActive: true,
              deployedBy: 'integration-test',
            },
          });
          const binding = await tx.decisionRuntimeBinding.create({
            data: {
              tenantId,
              artifactCode,
              environmentId: environment.id,
              activeDeploymentId: deployment.id,
            },
          });

          const cache = {
            getForTenant: jest.fn().mockResolvedValue(null),
            setForTenant: jest.fn().mockResolvedValue(undefined),
          };
          const resolver = new DeploymentResolverService(tx as never, cache as never);
          await expect(
            resolver.resolve(tenantId, artifactCode, environmentCode),
          ).resolves.toMatchObject({ deploymentId: deployment.id });

          await tx.decisionDeployment.update({
            where: { id: deployment.id },
            data: { deploymentStatus: 'SUSPENDED', isActive: false },
          });
          const stillBound = await tx.decisionRuntimeBinding.findUniqueOrThrow({
            where: { id: binding.id },
            select: { activeDeploymentId: true },
          });
          expect(stillBound.activeDeploymentId).toBe(deployment.id);
          await expect(
            resolver.resolve(tenantId, artifactCode, environmentCode),
          ).rejects.toMatchObject({ code: 'ACTIVE_DEPLOYMENT_NOT_FOUND' });
          expect(cache.setForTenant).toHaveBeenCalledTimes(1);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
      await expect(
        prisma.decisionArtifact.findFirst({ where: { tenantId, artifactCode } }),
      ).resolves.toBeNull();
    } finally {
      await prisma.$disconnect();
    }
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
