/**
 * Exposición concurrente y cierre del circuito de desenlaces, lado motor (P-11, brecha B15).
 *
 * El dueño AUTORITATIVO de la concesión es el core: el motor decide y el core concede. El motor
 * lee la exposición de los créditos ya registrados y no reserva nada, así que dos decisiones
 * simultáneas que caben por separado pueden pasar las dos. La primera prueba lo REPRODUCE y fija
 * lo que el motor sí debe dar para que el core pueda reservar con un bloqueo o una condición
 * atómica: el límite restante que vio y el vencimiento de la decisión.
 *
 * El resto fija la otra mitad del circuito: el registro de créditos es idempotente por referencia
 * externa y no cambia de sujeto al reenviarse, una fila que falla no se lleva el lote, y un
 * desenlace duplicado no incrementa numeradores ni deja la ventana pendiente.
 */
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../src/common/audit/audit.service';
import { HashService } from '../src/common/crypto/hash.service';
import { MetricsService } from '../src/common/observability/metrics.service';
import { TracingService } from '../src/common/observability/tracing.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import type { DeploymentResolverService } from '../src/modules/deployments/deployment-resolver.service';
import type { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import type { EngineExecutionResult } from '../src/modules/graph/graph.types';
import type { NestedTreeExecutionService } from '../src/modules/nested-trees/nested-tree-execution.service';
import { OutcomeIngestionService } from '../src/modules/outcome-ingestion/outcome-ingestion.service';
import { DecisionGuardService } from '../src/modules/risk-governance/decision-guard.service';
import { RiskGovernanceService } from '../src/modules/risk-governance/risk-governance.service';
import { ExecutionWriterService } from '../src/modules/runtime/execution-writer.service';
import { IdempotencyService } from '../src/modules/runtime/idempotency.service';
import type { ExecuteDecisionDto } from '../src/modules/runtime/runtime.dto';
import { RuntimeService } from '../src/modules/runtime/runtime.service';
import type { VariableResolutionService } from '../src/modules/variables/variable-resolution.service';
import type { WorkerServiceInvokerService } from '../src/modules/workers/worker-service-invoker.service';
import {
  createDecisionFixture,
  createExecution,
  type DecisionFixture,
} from './support/decision-fixture';
import { uniqueTenantId } from './support/unique-tenant';

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('Exposición y circuito de desenlaces, lado motor (integration)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  const db = prisma as unknown as PrismaService;
  const config = new ConfigService({
    AUDIT_HASH_SECRET: 'test-secret-with-at-least-32-characters-total',
    IDEMPOTENCY_TTL_HOURS: 24,
    OUTCOME_WINDOW_DAYS: '30,60',
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
      { execute: () => Promise.resolve(approved) } as unknown as ExecutionEngineService,
      new ExecutionWriterService(db, hashes, config),
      audit,
      new MetricsService(),
      { bind: () => undefined } as unknown as NestedTreeExecutionService,
      { bind: () => undefined } as unknown as WorkerServiceInvokerService,
      new TracingService(),
      new DecisionGuardService(db),
    );
  }

  afterAll(() => prisma.$disconnect());

  const facilityRow = (reference: string, executionId: bigint, principalAmount = 80) => ({
    externalReference: reference,
    originationExecutionId: executionId.toString(),
    principalAmount,
    currencyCode: 'BOB',
    termMonths: 6,
    annualRate: 0.24,
  });

  it('exposición 900, límite 1.000 y dos decisiones simultáneas de 80: el motor NO reserva y lo dice', async () => {
    const tenantId = uniqueTenantId(95);
    const fixture = await createDecisionFixture(prisma, tenantId);
    const ingestion = new OutcomeIngestionService(db, audit, new MetricsService(), config);
    await governance.recordConsent(
      tenantId,
      {
        subjectReference: 'solicitante-limite',
        purpose: 'credit_underwriting',
        basis: 'CREDIT_PROTECTION',
        grantedAt: '2026-01-01T00:00:00.000Z',
      },
      operator,
    );
    await prisma.exposureLimit.create({
      data: {
        tenantId,
        limitCode: 'SUBJECT_TOTAL',
        maxValue: 1_000,
        currencyCode: 'BOB',
        enforced: true,
        createdBy: 'riesgo',
      },
    });
    // 900 ya concedidos y registrados contra una decisión anterior del mismo titular.
    const subject = await prisma.decisionSubject.findFirstOrThrow({
      where: { tenantId, subjectReferenceHash: hashes.hmac('solicitante-limite') },
    });
    const previous = await createExecution(prisma, tenantId, fixture, {
      requestId: `prev-${Date.now()}`,
      subjectId: subject.id,
    });
    await ingestion.registerFacilities(
      tenantId,
      { facilities: [facilityRow(`L-900-${tenantId}`, previous.id, 900)] },
      operator,
    );

    const runtime = runtimeFor(fixture);
    const dto = (suffix: string) =>
      ({
        requestId: `conc-${suffix}-${Date.now()}`,
        idempotencyKey: `conc-${suffix}-${Date.now()}`,
        subjectReference: 'solicitante-limite',
        variables: { requested_amount: 80 },
      }) as ExecuteDecisionDto;
    const [a, b] = await Promise.all([
      runtime.execute(tenantId, fixture.artifactCode, dto('a'), runtimePrincipal),
      runtime.execute(tenantId, fixture.artifactCode, dto('b'), runtimePrincipal),
    ]);

    // Reproducción de B15: las dos caben por separado (900 + 80 ≤ 1.000) y pasan las dos, aunque
    // juntas (1.060) exceden el límite. El motor no es quien concede y no puede impedirlo.
    expect([a.httpStatus, b.httpStatus]).toEqual([200, 200]);
    // Lo que sí da, para que el core reserve de forma atómica: cuánto quedaba, cuánto queda si se
    // concede esto, y hasta cuándo vale la decisión.
    for (const response of [a, b]) {
      expect(response.body.exposure).toEqual({
        limitCode: 'SUBJECT_TOTAL',
        currencyCode: 'BOB',
        maxValue: 1_000,
        enforced: true,
        currentExposure: 900,
        requestedAmount: 80,
        remainingBeforeDecision: 100,
        remainingAfterDecision: 20,
      });
      expect(Date.parse(String(response.body.decisionValidUntil))).toBeGreaterThan(Date.now());
    }
  });

  it('el registro de un crédito es idempotente por referencia externa y no cambia de sujeto al reenviarse', async () => {
    const tenantId = uniqueTenantId(96);
    const fixture = await createDecisionFixture(prisma, tenantId);
    const ingestion = new OutcomeIngestionService(db, audit, new MetricsService(), config);
    const s1 = await prisma.decisionSubject.create({
      data: { tenantId, subjectReferenceHash: hashes.hmac('titular-1') },
    });
    const s2 = await prisma.decisionSubject.create({
      data: { tenantId, subjectReferenceHash: hashes.hmac('titular-2') },
    });
    const e1 = await createExecution(prisma, tenantId, fixture, {
      requestId: `f1-${Date.now()}`,
      subjectId: s1.id,
    });
    const e2 = await createExecution(prisma, tenantId, fixture, {
      requestId: `f2-${Date.now()}`,
      subjectId: s2.id,
    });
    const reference = `L-REENVIO-${tenantId}`;

    const first = await ingestion.registerFacilities(
      tenantId,
      { facilities: [facilityRow(reference, e1.id)] },
      operator,
    );
    const resend = await ingestion.registerFacilities(
      tenantId,
      { facilities: [facilityRow(reference, e1.id, 85)] },
      operator,
    );
    const hijack = await ingestion.registerFacilities(
      tenantId,
      { facilities: [facilityRow(reference, e2.id)] },
      operator,
    );

    expect(first).toMatchObject({ registered: 1, duplicates: 0 });
    expect(resend).toMatchObject({ registered: 1, duplicates: 1 });
    expect(resend.rows[0]).toMatchObject({ accepted: true, duplicate: true });
    // Citar OTRA decisión (de otra persona) con la misma referencia no reasigna el crédito.
    expect(hijack.rows[0]).toMatchObject({ accepted: false, code: 'FACILITY_REFERENCE_CONFLICT' });
    const facility = await prisma.creditFacility.findUniqueOrThrow({
      where: { tenantId_externalReference: { tenantId, externalReference: reference } },
    });
    expect(facility.subjectId).toBe(s1.id);
    expect(facility.originationExecutionId).toBe(e1.id);
    expect(Number(facility.principalAmount)).toBe(85);
    // Las ventanas de la otra decisión no quedaron atadas a este crédito.
    const foreignWindows = await prisma.outcomeWindowSchedule.count({
      where: { tenantId, executionId: e2.id, facilityId: facility.id },
    });
    expect(foreignWindows).toBe(0);
  });

  it('error parcial por fila: la fila mala vuelve con su código y el resto del lote se registra', async () => {
    const tenantId = uniqueTenantId(97);
    const fixture = await createDecisionFixture(prisma, tenantId);
    const ingestion = new OutcomeIngestionService(db, audit, new MetricsService(), config);
    const subject = await prisma.decisionSubject.create({
      data: { tenantId, subjectReferenceHash: hashes.hmac('titular-lote') },
    });
    const good = await createExecution(prisma, tenantId, fixture, {
      requestId: `ok-${Date.now()}`,
      subjectId: subject.id,
    });
    const undecided = await createExecution(prisma, tenantId, fixture, {
      requestId: `nd-${Date.now()}`,
      subjectId: subject.id,
      decisionStatus: 'NO_DECISION',
    });
    const batch = {
      facilities: [
        facilityRow(`L-A-${tenantId}`, good.id),
        facilityRow(`L-B-${tenantId}`, undecided.id),
        facilityRow(`L-C-${tenantId}`, 999_999_999_999n),
        // Un importe que la columna no admite (18,4): falla la ESCRITURA de esta fila.
        facilityRow(`L-D-${tenantId}`, good.id, 1e20),
      ],
    };
    const result = await ingestion.registerFacilities(tenantId, batch, operator);
    expect(result.rows.map((row) => [row.accepted, row.code ?? null])).toEqual([
      [true, null],
      [false, 'EXECUTION_NOT_DECIDED'],
      [false, 'EXECUTION_NOT_FOUND'],
      [false, 'FACILITY_REGISTRATION_FAILED'],
    ]);
    // Reenviar el lote entero es seguro: la buena sale como duplicada, nada se duplica.
    const again = await ingestion.registerFacilities(tenantId, batch, operator);
    expect(again.rows[0]).toMatchObject({ accepted: true, duplicate: true });
    expect(
      await prisma.creditFacility.count({
        where: { tenantId, externalReference: { startsWith: 'L-' } },
      }),
    ).toBe(1);
  });

  it('un desenlace duplicado no incrementa numeradores ni deja la ventana pendiente', async () => {
    const tenantId = uniqueTenantId(98);
    const fixture = await createDecisionFixture(prisma, tenantId);
    const metrics = new MetricsService();
    const counted = jest.spyOn(metrics, 'recordObservedOutcome');
    const ingestion = new OutcomeIngestionService(db, audit, metrics, config);
    const subject = await prisma.decisionSubject.create({
      data: { tenantId, subjectReferenceHash: hashes.hmac('titular-desenlace') },
    });
    const execution = await createExecution(prisma, tenantId, fixture, {
      requestId: `oc-${Date.now()}`,
      subjectId: subject.id,
    });
    const reference = `L-OUT-${tenantId}`;
    await ingestion.registerFacilities(
      tenantId,
      { facilities: [facilityRow(reference, execution.id)] },
      operator,
    );
    const outcome = {
      externalReference: reference,
      windowDays: 30,
      label: 'GOOD' as const,
      source: 'core',
    };

    const first = await ingestion.recordBatch(tenantId, { outcomes: [outcome] }, operator);
    const observedAt = (
      await prisma.decisionOutcomeObservation.findFirstOrThrow({
        where: { executionId: execution.id, windowDays: 30 },
      })
    ).observedAt;
    // Reenvío idéntico, y además repetido dentro del mismo lote.
    const resend = await ingestion.recordBatch(
      tenantId,
      { outcomes: [outcome, outcome] },
      operator,
    );
    // Otra etiqueta para la misma ventana: conflicto, no se pisa la evidencia.
    const conflict = await ingestion.recordBatch(
      tenantId,
      { outcomes: [{ ...outcome, label: 'BAD' as const }] },
      operator,
    );

    expect(first).toMatchObject({ accepted: 1, duplicates: 0 });
    expect(resend).toMatchObject({ accepted: 2, duplicates: 2, rejected: 0 });
    expect(conflict.rows[0]).toMatchObject({ accepted: false, code: 'OUTCOME_CONFLICT' });
    expect(counted).toHaveBeenCalledTimes(1);
    const rows = await prisma.decisionOutcomeObservation.findMany({
      where: { executionId: execution.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('GOOD');
    expect(rows[0].observedAt).toEqual(observedAt);
    const window = await prisma.outcomeWindowSchedule.findFirstOrThrow({
      where: { executionId: execution.id, windowDays: 30 },
    });
    expect(window.observedAt).not.toBeNull();
  });

  it('un reenvío cierra la ventana que una carga por la vía antigua dejó pendiente', async () => {
    const tenantId = uniqueTenantId(99);
    const fixture = await createDecisionFixture(prisma, tenantId);
    const metrics = new MetricsService();
    const counted = jest.spyOn(metrics, 'recordObservedOutcome');
    const ingestion = new OutcomeIngestionService(db, audit, metrics, config);
    const subject = await prisma.decisionSubject.create({
      data: { tenantId, subjectReferenceHash: hashes.hmac('titular-antiguo') },
    });
    const execution = await createExecution(prisma, tenantId, fixture, {
      requestId: `old-${Date.now()}`,
      subjectId: subject.id,
    });
    const reference = `L-OLD-${tenantId}`;
    await ingestion.registerFacilities(
      tenantId,
      { facilities: [facilityRow(reference, execution.id)] },
      operator,
    );
    // La vía antigua escribe la observación sin tocar la ventana.
    await prisma.decisionOutcomeObservation.create({
      data: {
        tenantId,
        executionId: execution.id,
        windowDays: 60,
        label: 'GOOD',
        source: 'legacy',
        recordedBy: 'legacy',
      },
    });
    const result = await ingestion.recordBatch(
      tenantId,
      {
        outcomes: [{ externalReference: reference, windowDays: 60, label: 'GOOD', source: 'core' }],
      },
      operator,
    );
    expect(result.rows[0]).toMatchObject({ accepted: true, duplicate: true });
    expect(counted).not.toHaveBeenCalled();
    const window = await prisma.outcomeWindowSchedule.findFirstOrThrow({
      where: { executionId: execution.id, windowDays: 60 },
    });
    expect(window.observedAt).not.toBeNull();
  });
});
