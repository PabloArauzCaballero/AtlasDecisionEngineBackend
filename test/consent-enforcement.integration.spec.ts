/**
 * Sujeto y base habilitante exigibles, contra Postgres (P-09, brecha B11).
 *
 * Lo que se mide es el CIRCUITO: la réplica de la base desde el core (`RiskGovernanceService`),
 * la decisión (`RuntimeService` con guardia, escritor, idempotencia y auditoría reales) y lo que
 * queda escrito. Sólo el grafo y la resolución de variables son dobles: aquí no se juzga el
 * modelo, se juzga si se le deja decidir.
 *
 * Aceptación del plan: primer solicitante sin sujeto local, finalidad requerida ausente,
 * revocación durante caída, vencimiento, replay y tenant ajeno. Con evidencia faltante se deriva
 * o se bloquea según política, sin emitir una aprobación utilizable para originar.
 */
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '@prisma/client';
import { AuditService } from '../src/common/audit/audit.service';
import { HashService } from '../src/common/crypto/hash.service';
import { DomainException } from '../src/common/errors/domain-exception';
import { MetricsService } from '../src/common/observability/metrics.service';
import { TracingService } from '../src/common/observability/tracing.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import type { DeploymentResolverService } from '../src/modules/deployments/deployment-resolver.service';
import type { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import type { EngineExecutionResult } from '../src/modules/graph/graph.types';
import type { NestedTreeExecutionService } from '../src/modules/nested-trees/nested-tree-execution.service';
import { DecisionGuardService } from '../src/modules/risk-governance/decision-guard.service';
import { RiskGovernanceService } from '../src/modules/risk-governance/risk-governance.service';
import { ExecutionWriterService } from '../src/modules/runtime/execution-writer.service';
import { IdempotencyService } from '../src/modules/runtime/idempotency.service';
import type { ExecuteDecisionDto } from '../src/modules/runtime/runtime.dto';
import { RuntimeService } from '../src/modules/runtime/runtime.service';
import type { VariableResolutionService } from '../src/modules/variables/variable-resolution.service';
import type { WorkerServiceInvokerService } from '../src/modules/workers/worker-service-invoker.service';
import { createDecisionFixture, type DecisionFixture } from './support/decision-fixture';
import { uniqueTenantId } from './support/unique-tenant';

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('Base habilitante exigible de extremo a extremo (integration)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  const db = prisma as unknown as PrismaService;
  const config = new ConfigService({
    AUDIT_HASH_SECRET: 'test-secret-with-at-least-32-characters-total',
    IDEMPOTENCY_TTL_HOURS: 24,
  });
  const hashes = new HashService(config);
  const audit = new AuditService(db, hashes);
  const governance = new RiskGovernanceService(db, hashes, audit);
  const operator = { id: 'core-sync', requestId: 'sync-1' } as unknown as AuthenticatedPrincipal;
  const runtimePrincipal = {
    id: 'core-runtime',
    roles: [],
    audience: 'runtime',
    requestId: 'req-1',
    authMethod: 'api_key',
  } as unknown as AuthenticatedPrincipal;

  let engineCalls = 0;
  const approved: EngineExecutionResult = {
    status: 'SUCCEEDED',
    outcome: 'APPROVED',
    output: { approved_credit_limit: 80 },
    reasons: [],
    trace: [],
    visitedNodeKeys: [],
    traversedEdgeKeys: [],
    nestedExecutions: [],
    calculatedFieldCalls: [],
    workerCalls: [],
  };

  function runtimeFor(fixture: DecisionFixture) {
    return new RuntimeService(
      config,
      db,
      hashes,
      new IdempotencyService(db, hashes, config),
      {
        resolve: () => Promise.resolve(fixture.deployment),
      } as unknown as DeploymentResolverService,
      {
        resolve: (_contracts: unknown, input: Record<string, unknown>) =>
          Promise.resolve({ valid: true, values: input, snapshots: [], errors: [] }),
      } as unknown as VariableResolutionService,
      {
        execute: () => {
          engineCalls += 1;
          return Promise.resolve(approved);
        },
      } as unknown as ExecutionEngineService,
      new ExecutionWriterService(db, hashes, config),
      audit,
      new MetricsService(),
      { bind: () => undefined } as unknown as NestedTreeExecutionService,
      { bind: () => undefined } as unknown as WorkerServiceInvokerService,
      new TracingService(),
      new DecisionGuardService(db),
    );
  }

  let sequence = 0;
  function request(subjectReference?: string, key?: string): ExecuteDecisionDto {
    sequence += 1;
    const id = key ?? `consent-${Date.now()}-${sequence}`;
    return {
      requestId: id,
      idempotencyKey: id,
      subjectReference,
      variables: { requested_amount: 80 },
    } as ExecuteDecisionDto;
  }

  async function grant(
    tenantId: bigint,
    subjectReference: string,
    overrides: Partial<{
      purpose: string;
      basis: 'CONSENT' | 'CREDIT_PROTECTION';
      grantedAt: string;
      expiresAt: string;
      consentVersion: string;
    }> = {},
  ) {
    return governance.recordConsent(
      tenantId,
      {
        subjectReference,
        purpose: 'credit_underwriting',
        basis: 'CREDIT_PROTECTION',
        grantedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
      },
      operator,
    );
  }

  afterAll(() => prisma.$disconnect());
  beforeEach(() => {
    engineCalls = 0;
  });

  it('primer solicitante sin sujeto local y sin base: NO_DECISION en revisión, sin ejecutar el grafo', async () => {
    const tenantId = uniqueTenantId(81);
    const fixture = await createDecisionFixture(prisma, tenantId);
    const response = await runtimeFor(fixture).execute(
      tenantId,
      fixture.artifactCode,
      request('solicitante-nuevo'),
      runtimePrincipal,
    );

    expect(response.httpStatus).toBe(422);
    expect(response.body).toMatchObject({
      status: 'NO_DECISION',
      outcome: 'NO_DECISION',
      decisionValidUntil: null,
      reasonCodes: [
        expect.objectContaining({ code: 'ENABLING_BASIS_MISSING', adverseAction: false }),
      ],
      errors: [{ code: 'ENABLING_BASIS_NO_BASIS_RECORDED', purpose: 'credit_underwriting' }],
      enablingBasis: { policySource: 'ORIGINATION_DEFAULT' },
    });
    // No se trató el dato: el grafo no corrió y la evidencia no guarda las variables.
    expect(engineCalls).toBe(0);
    const execution = await prisma.decisionExecution.findUniqueOrThrow({
      where: { id: BigInt(String(response.body.executionId)) },
      include: { errors: true, outcomeWindows: true },
    });
    expect(execution.decisionStatus).toBe('NO_DECISION');
    expect(execution.inputSnapshotJson).toEqual({});
    expect(execution.subjectId).not.toBeNull();
    expect(execution.errors.map((error) => error.errorCode)).toEqual([
      'ENABLING_BASIS_NO_BASIS_RECORDED',
    ]);
    // Una decisión no tomada no programa ventanas que nadie podría cerrar.
    expect(execution.outcomeWindows).toEqual([]);
  });

  it('la base registrada ANTES de la primera decisión habilita al primer solicitante', async () => {
    const tenantId = uniqueTenantId(82);
    const fixture = await createDecisionFixture(prisma, tenantId);
    // Antes respondía SUBJECT_NOT_FOUND: el core sólo podía registrar la base DESPUÉS de decidir.
    await expect(grant(tenantId, 'solicitante-previo')).resolves.toMatchObject({
      purpose: 'credit_underwriting',
    });

    const response = await runtimeFor(fixture).execute(
      tenantId,
      fixture.artifactCode,
      request('solicitante-previo'),
      runtimePrincipal,
    );
    expect(response.httpStatus).toBe(200);
    expect(response.body).toMatchObject({ status: 'SUCCEEDED', outcome: 'APPROVED' });
    expect(typeof response.body.decisionValidUntil).toBe('string');
    expect(engineCalls).toBe(1);
  });

  it('sin subjectReference una decisión que exige base no se puede aprobar', async () => {
    const tenantId = uniqueTenantId(83);
    const fixture = await createDecisionFixture(prisma, tenantId);
    const response = await runtimeFor(fixture).execute(
      tenantId,
      fixture.artifactCode,
      request(undefined),
      runtimePrincipal,
    );
    expect(response.httpStatus).toBe(422);
    expect(response.body.errors).toEqual([
      { code: 'ENABLING_BASIS_SUBJECT_REFERENCE_MISSING', purpose: 'credit_underwriting' },
    ]);
    expect(engineCalls).toBe(0);
  });

  it('finalidad requerida ausente: tener OTRA finalidad no habilita esta', async () => {
    const tenantId = uniqueTenantId(84);
    const fixture = await createDecisionFixture(prisma, tenantId, {
      enablingBasisPolicy: {
        onMissing: 'REVIEW',
        requirements: [{ purpose: 'BUREAU_QUERY', acceptedBases: ['CONSENT'] }],
      },
    });
    await grant(tenantId, 'solicitante-finalidad');
    const response = await runtimeFor(fixture).execute(
      tenantId,
      fixture.artifactCode,
      request('solicitante-finalidad'),
      runtimePrincipal,
    );
    expect(response.httpStatus).toBe(422);
    expect(response.body.errors).toEqual([
      { code: 'ENABLING_BASIS_PURPOSE_NOT_COVERED', purpose: 'BUREAU_QUERY' },
    ]);
  });

  it('consentimiento como base cuando el artefacto lo declara: otra base no basta', async () => {
    const tenantId = uniqueTenantId(85);
    const fixture = await createDecisionFixture(prisma, tenantId, { legalBasis: 'CONSENT' });
    await grant(tenantId, 'solicitante-consent', { basis: 'CREDIT_PROTECTION' });
    const response = await runtimeFor(fixture).execute(
      tenantId,
      fixture.artifactCode,
      request('solicitante-consent'),
      runtimePrincipal,
    );
    expect(response.body.errors).toEqual([
      { code: 'ENABLING_BASIS_BASIS_NOT_ACCEPTED', purpose: 'credit_underwriting' },
    ]);
  });

  it('con política BLOCK la base ausente rechaza la petición (403) y no ejecuta', async () => {
    const tenantId = uniqueTenantId(86);
    const fixture = await createDecisionFixture(prisma, tenantId, {
      enablingBasisPolicy: {
        onMissing: 'BLOCK',
        requirements: [{ purpose: 'credit_underwriting', acceptedBases: ['CREDIT_PROTECTION'] }],
      },
    });
    await expect(
      runtimeFor(fixture).execute(
        tenantId,
        fixture.artifactCode,
        request('solicitante-block'),
        runtimePrincipal,
      ),
    ).rejects.toMatchObject({ code: 'ENABLING_BASIS_INVALID', status: 403 });
    expect(engineCalls).toBe(0);
  });

  it('vencimiento: una base expirada bloquea con su motivo', async () => {
    const tenantId = uniqueTenantId(87);
    const fixture = await createDecisionFixture(prisma, tenantId);
    await grant(tenantId, 'solicitante-vencido', { expiresAt: '2026-02-01T00:00:00.000Z' });
    const failure = await runtimeFor(fixture)
      .execute(tenantId, fixture.artifactCode, request('solicitante-vencido'), runtimePrincipal)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DomainException);
    expect(failure).toMatchObject({
      code: 'SUBJECT_CONSENT_INVALID',
      details: { purposes: [{ purpose: 'credit_underwriting', reason: 'EXPIRED' }] },
    });
  });

  it('revocación durante caída: la réplica tardía bloquea y un alta vieja no la resucita', async () => {
    const tenantId = uniqueTenantId(88);
    const fixture = await createDecisionFixture(prisma, tenantId);
    await grant(tenantId, 'solicitante-revoca');
    // El titular revocó el 1-sep; el motor estaba caído y la réplica llega hoy, fechada.
    await governance.revokeConsent(
      tenantId,
      {
        subjectReference: 'solicitante-revoca',
        purpose: 'credit_underwriting',
        revokedAt: '2026-09-01T00:00:00.000Z',
      },
      operator,
    );
    // El core reintenta el alta original (reenvío de su cola): es una réplica vieja.
    await expect(grant(tenantId, 'solicitante-revoca')).rejects.toMatchObject({
      code: 'CONSENT_GRANT_REPLAYED',
    });
    await expect(
      runtimeFor(fixture).execute(
        tenantId,
        fixture.artifactCode,
        request('solicitante-revoca'),
        runtimePrincipal,
      ),
    ).rejects.toMatchObject({
      code: 'SUBJECT_CONSENT_INVALID',
      details: { purposes: [{ purpose: 'credit_underwriting', reason: 'REVOKED' }] },
    });
    // Una renovación REAL, posterior a la revocación, sí vuelve a habilitar.
    await grant(tenantId, 'solicitante-revoca', { grantedAt: '2026-09-10T00:00:00.000Z' });
    const renewed = await runtimeFor(fixture).execute(
      tenantId,
      fixture.artifactCode,
      request('solicitante-revoca'),
      runtimePrincipal,
    );
    expect(renewed.httpStatus).toBe(200);
  });

  it('una revocación que llega ANTES que el alta deja lápida: el alta vieja no crea el permiso', async () => {
    const tenantId = uniqueTenantId(89);
    const fixture = await createDecisionFixture(prisma, tenantId);
    await governance.revokeConsent(
      tenantId,
      {
        subjectReference: 'solicitante-desorden',
        purpose: 'credit_underwriting',
        revokedAt: '2026-09-01T00:00:00.000Z',
      },
      operator,
    );
    await expect(grant(tenantId, 'solicitante-desorden')).rejects.toMatchObject({
      code: 'CONSENT_GRANT_REPLAYED',
    });
    await expect(
      runtimeFor(fixture).execute(
        tenantId,
        fixture.artifactCode,
        request('solicitante-desorden'),
        runtimePrincipal,
      ),
    ).rejects.toMatchObject({ code: 'SUBJECT_CONSENT_INVALID' });
  });

  it('una revocación anterior a un alta posterior es obsoleta y no pisa el alta', async () => {
    const tenantId = uniqueTenantId(90);
    await grant(tenantId, 'solicitante-obsoleta', { grantedAt: '2026-09-10T00:00:00.000Z' });
    await expect(
      governance.revokeConsent(
        tenantId,
        {
          subjectReference: 'solicitante-obsoleta',
          purpose: 'credit_underwriting',
          revokedAt: '2026-09-01T00:00:00.000Z',
        },
        operator,
      ),
    ).rejects.toMatchObject({ code: 'CONSENT_REVOCATION_STALE' });
  });

  it('replay de la decisión: la misma clave devuelve la decisión original con su vencimiento, no una nueva aprobación', async () => {
    const tenantId = uniqueTenantId(91);
    const fixture = await createDecisionFixture(prisma, tenantId);
    await grant(tenantId, 'solicitante-replay');
    const runtime = runtimeFor(fixture);
    const key = `replay-${Date.now()}`;
    const first = await runtime.execute(
      tenantId,
      fixture.artifactCode,
      request('solicitante-replay', key),
      runtimePrincipal,
    );
    await governance.revokeConsent(
      tenantId,
      { subjectReference: 'solicitante-replay', purpose: 'credit_underwriting' },
      operator,
    );
    const replay = await runtime.execute(
      tenantId,
      fixture.artifactCode,
      request('solicitante-replay', key),
      runtimePrincipal,
    );
    // La réplica es la MISMA decisión (mismo executionId y mismo vencimiento), no una nueva:
    // el grafo no volvió a correr y quien concede la revalida por `decisionValidUntil`.
    expect(replay.body.executionId).toBe(first.body.executionId);
    expect(replay.body.decisionValidUntil).toBe(first.body.decisionValidUntil);
    expect(engineCalls).toBe(1);
    // Una petición NUEVA tras la revocación ya no pasa.
    await expect(
      runtime.execute(
        tenantId,
        fixture.artifactCode,
        request('solicitante-replay'),
        runtimePrincipal,
      ),
    ).rejects.toMatchObject({ code: 'SUBJECT_CONSENT_INVALID' });
  });

  it('tenant ajeno: la base registrada en otro tenant no habilita aquí', async () => {
    const tenantA = uniqueTenantId(92);
    const tenantB = uniqueTenantId(93);
    const fixture = await createDecisionFixture(prisma, tenantA);
    await grant(tenantB, 'solicitante-compartido');
    const response = await runtimeFor(fixture).execute(
      tenantA,
      fixture.artifactCode,
      request('solicitante-compartido'),
      runtimePrincipal,
    );
    expect(response.httpStatus).toBe(422);
    expect(response.body.errors).toEqual([
      { code: 'ENABLING_BASIS_NO_BASIS_RECORDED', purpose: 'credit_underwriting' },
    ]);
    // Y el sujeto del otro tenant no es el de éste.
    const subjects = await prisma.decisionSubject.findMany({
      where: {
        subjectReferenceHash: hashes.hmac('solicitante-compartido'),
        tenantId: { in: [tenantA, tenantB] },
      },
      select: { tenantId: true },
    });
    expect(new Set(subjects.map((subject) => subject.tenantId.toString())).size).toBe(2);
  });

  it('la versión del texto aceptada se exige cuando la política la declara', async () => {
    const tenantId = uniqueTenantId(94);
    const fixture = await createDecisionFixture(prisma, tenantId, {
      enablingBasisPolicy: {
        onMissing: 'REVIEW',
        requirements: [
          {
            purpose: 'credit_underwriting',
            acceptedBases: ['CONSENT'],
            acceptedVersions: ['v3'],
          },
        ],
      } as Prisma.InputJsonValue,
    });
    await grant(tenantId, 'solicitante-version', { basis: 'CONSENT', consentVersion: 'v2' });
    const response = await runtimeFor(fixture).execute(
      tenantId,
      fixture.artifactCode,
      request('solicitante-version'),
      runtimePrincipal,
    );
    expect(response.body.errors).toEqual([
      { code: 'ENABLING_BASIS_VERSION_NOT_ACCEPTED', purpose: 'credit_underwriting' },
    ]);
  });
});
