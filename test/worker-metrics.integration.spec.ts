import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, WorkerInputSource, WorkerRunStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { WorkerMetricsService } from '../src/modules/workers/worker-metrics.service';
import { uniqueTenantId } from './support/unique-tenant';

/**
 * Las métricas de un worker, contra PostgreSQL de verdad.
 *
 * Lo que se comprueba aquí no se puede comprobar con dobles: los percentiles
 * son `percentile_cont`, el agrupado por causa es un `DISTINCT ON` y el
 * aislamiento por tenant es una cláusula de la consulta. Un doble los daría
 * todos por buenos porque los implementaría en JavaScript, que es justo donde
 * NO están.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('métricas de los workers adicionales (integración)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  const service = new WorkerMetricsService(prisma as unknown as PrismaService);
  let tenantId: bigint;
  let nextTenant = uniqueTenantId(11);

  beforeEach(() => {
    // Un tenant propio por prueba: más barato que limpiar, y hace que el filtro
    // por tenant se ejercite de verdad en cada caso.
    nextTenant += 1n;
    tenantId = nextTenant;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const AHORA = Date.now();
  const hace = (minutos: number) => new Date(AHORA - minutos * 60_000);

  /** Una ejecución de extracto ya terminada, con la duración que se le pida. */
  async function terminada(options: {
    status: WorkerRunStatus;
    haceMinutos: number;
    esperaMs?: number;
    procesoMs?: number;
    errorCode?: string;
    tenant?: bigint;
  }) {
    const queuedAt = hace(options.haceMinutos);
    const startedAt = new Date(queuedAt.getTime() + (options.esperaMs ?? 0));
    const finishedAt = new Date(startedAt.getTime() + (options.procesoMs ?? 0));
    return prisma.bankStatementRun.create({
      data: {
        tenantId: options.tenant ?? tenantId,
        requestId: randomUUID(),
        status: options.status,
        inputSource: WorkerInputSource.FIXTURE,
        fileName: 'extracto.pdf',
        fileHash: randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64),
        fileSizeBytes: 1_024,
        requestedBy: 'prueba@atlas',
        correlationId: randomUUID(),
        errorCode: options.errorCode ?? null,
        errorMessage: options.errorCode ? 'Detalle del fallo.' : null,
        attemptCount: 1,
        queuedAt,
        startedAt,
        finishedAt,
      },
    });
  }

  it('calcula la mediana y el p95 sobre TODA la ventana, no sobre una página', async () => {
    // Noventa y nueve de 100 ms y una de 10 s: la mediana tiene que seguir
    // siendo 100 ms y el máximo delatar la lenta. Es el caso que una página de
    // cincuenta filas mediría mal según cuáles le tocaran.
    for (let i = 0; i < 99; i += 1) {
      await terminada({ status: WorkerRunStatus.SUCCEEDED, haceMinutos: 30, procesoMs: 100 });
    }
    await terminada({ status: WorkerRunStatus.SUCCEEDED, haceMinutos: 30, procesoMs: 10_000 });

    const metrics = await service.collect(tenantId, 'bank-statement', 24);

    expect(metrics.latency.samples).toBe(100);
    expect(metrics.latency.p50Ms).toBeCloseTo(100, 0);
    expect(metrics.latency.maxMs).toBeCloseTo(10_000, 0);
    expect(metrics.latency.p99Ms).toBeGreaterThan(metrics.latency.p50Ms!);
  });

  it('mide la espera en cola aparte del proceso', async () => {
    await terminada({
      status: WorkerRunStatus.SUCCEEDED,
      haceMinutos: 10,
      esperaMs: 4_000,
      procesoMs: 250,
    });

    const metrics = await service.collect(tenantId, 'bank-statement', 24);

    expect(metrics.latency.avgWaitMs).toBeCloseTo(4_000, 0);
    expect(metrics.latency.p50Ms).toBeCloseTo(250, 0);
  });

  it('deja fuera lo anterior a la ventana', async () => {
    await terminada({ status: WorkerRunStatus.SUCCEEDED, haceMinutos: 30, procesoMs: 100 });
    await terminada({ status: WorkerRunStatus.SUCCEEDED, haceMinutos: 60 * 40, procesoMs: 100 });

    const metrics = await service.collect(tenantId, 'bank-statement', 24);

    expect(metrics.totalRuns).toBe(1);
  });

  it('no ve las ejecuciones de otro tenant', async () => {
    await terminada({ status: WorkerRunStatus.SUCCEEDED, haceMinutos: 10, procesoMs: 100 });
    await terminada({
      status: WorkerRunStatus.FAILED,
      haceMinutos: 10,
      errorCode: 'AJENO',
      tenant: tenantId + 1_000n,
    });

    const metrics = await service.collect(tenantId, 'bank-statement', 24);

    expect(metrics.totalRuns).toBe(1);
    expect(metrics.incidents).toHaveLength(0);
  });

  it('agrupa los fallos por causa y conserva el rastro del más reciente', async () => {
    await terminada({
      status: WorkerRunStatus.FAILED,
      haceMinutos: 90,
      errorCode: 'PDF_EXTRACTION_FAILED',
    });
    const reciente = await terminada({
      status: WorkerRunStatus.FAILED,
      haceMinutos: 5,
      errorCode: 'PDF_EXTRACTION_FAILED',
    });
    await terminada({ status: WorkerRunStatus.FAILED, haceMinutos: 20, errorCode: 'TIMEOUT' });

    const { incidents } = await service.collect(tenantId, 'bank-statement', 24);

    expect(incidents.map((incident) => [incident.code, incident.count])).toEqual([
      ['PDF_EXTRACTION_FAILED', 2],
      ['TIMEOUT', 1],
    ]);
    // El rastro es el de la ÚLTIMA vez que ocurrió, que es por donde se empieza
    // a mirar en los registros del motor.
    expect(incidents[0].lastRequestId).toBe(reciente.requestId);
    expect(incidents[0].lastCorrelationId).toBe(reciente.correlationId);
  });

  it('un fallo sin código no desaparece: se agrupa como SIN_CODIGO', async () => {
    await terminada({ status: WorkerRunStatus.FAILED, haceMinutos: 5 });

    const { incidents } = await service.collect(tenantId, 'bank-statement', 24);

    expect(incidents).toHaveLength(1);
    expect(incidents[0].code).toBe('SIN_CODIGO');
  });

  it('sobre una ventana vacía no inventa ceros', async () => {
    const metrics = await service.collect(tenantId, 'bank-statement', 24);

    expect(metrics.totalRuns).toBe(0);
    expect(metrics.successRate).toBeNull();
    expect(metrics.latency.p50Ms).toBeNull();
    expect(metrics.queue.oldestQueuedAt).toBeNull();
    expect(metrics.lastRunAt).toBeNull();
  });
});
