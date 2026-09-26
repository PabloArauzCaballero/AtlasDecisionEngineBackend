import { ConfigService } from '@nestjs/config';
import { WorkerRunStatus } from '@prisma/client';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { WorkerMetricsService } from '../src/modules/workers/worker-metrics.service';
import { WorkersController } from '../src/modules/workers/workers.controller';

/**
 * Cómo se interpreta lo que la base devuelve.
 *
 * El SQL en sí —los percentiles y el agrupado por causa— se ejercita contra
 * PostgreSQL de verdad en `worker-metrics.integration.spec.ts`: un doble los
 * daría por buenos porque los reimplementaría en JavaScript, que es justo donde
 * NO están. Lo que se comprueba aquí es la aritmética que sí vive en el motor y
 * las decisiones que se toman con ella, que es donde estaban los errores que
 * este endpoint vino a corregir.
 */

/** Fila del resumen, con todo a cero salvo lo que cada prueba fije. */
function summaryRow(overrides: Record<string, unknown> = {}) {
  return {
    total: 0,
    queued: 0,
    running: 0,
    succeeded: 0,
    succeededWithWarnings: 0,
    failed: 0,
    cancelled: 0,
    latencySamples: 0,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    maxMs: null,
    avgWaitMs: null,
    maxWaitMs: null,
    oldestQueuedAt: null,
    lastRunAt: null,
    ...overrides,
  };
}

/**
 * Prisma doble.
 *
 * Las dos consultas viajan en UNA `$transaction`, y no sueltas: es lo que hace
 * que `applyTenantRls` fije `app.tenant_id` antes de ejecutarlas. Sin eso, la
 * política de estas tablas evalúa `''::bigint` sobre una conexión reutilizada y
 * la petición muere con un `22P02` intermitente. El doble refleja esa forma para
 * que quitarla rompa aquí y no en producción.
 */
function build(summary: Record<string, unknown>, incidents: unknown[] = []) {
  const $queryRaw = jest.fn((...args: unknown[]) => args);
  const $transaction = jest.fn().mockResolvedValue([[summaryRow(summary)], incidents]);
  const prisma = { $queryRaw, $transaction } as unknown as PrismaService;
  return { service: new WorkerMetricsService(prisma), $queryRaw, $transaction };
}

describe('métricas de un worker', () => {
  it('mide el éxito sobre lo que terminó, y las canceladas no cuentan', async () => {
    const { service } = build({
      total: 10,
      succeeded: 6,
      succeededWithWarnings: 2,
      failed: 2,
      // Cancelar no es un fallo del worker: nadie llegó a procesarla. Si entrara
      // en el denominador, cancelar trabajo bajaría la salud del servicio.
      cancelled: 5,
    });

    const metrics = await service.collect(1n, 'bank-statement', 24);

    expect(metrics.finishedRuns).toBe(10);
    expect(metrics.successRate).toBe(80);
  });

  it('sin ejecuciones terminadas devuelve null y no un cero', async () => {
    const { service } = build({ total: 3, queued: 3 });

    const metrics = await service.collect(1n, 'semantic-analysis', 24);

    // Un 0 % afirmaría que todas fallaron, que es lo contrario de lo que pasa.
    expect(metrics.successRate).toBeNull();
    expect(metrics.latency.p50Ms).toBeNull();
    expect(metrics.latency.samples).toBe(0);
  });

  it('omite del reparto los estados que no ocurrieron y ordena por volumen', async () => {
    const { service } = build({ total: 12, succeeded: 3, failed: 8, queued: 1 });

    const { statusMix } = await service.collect(1n, 'bank-statement', 24);

    expect(statusMix).toEqual([
      { status: WorkerRunStatus.FAILED, count: 8 },
      { status: WorkerRunStatus.SUCCEEDED, count: 3 },
      { status: WorkerRunStatus.QUEUED, count: 1 },
    ]);
  });

  it('separa la cola de la ventana: es el estado de ahora, no del periodo', async () => {
    const oldest = new Date('2026-08-06T10:00:00.000Z');
    const { service } = build({ total: 4, queued: 3, running: 1, oldestQueuedAt: oldest });

    const { queue } = await service.collect(1n, 'semantic-analysis', 24);

    expect(queue).toEqual({ queued: 3, running: 1, oldestQueuedAt: oldest });
  });

  it('la ventana se calcula hacia atrás desde ahora, en horas', async () => {
    const { service, $queryRaw, $transaction } = build({});
    const antes = Date.now();

    const { windowFrom } = await service.collect(1n, 'bank-statement', 48);

    const esperado = antes - 48 * 3_600_000;
    expect(windowFrom.getTime()).toBeGreaterThanOrEqual(esperado - 5_000);
    expect(windowFrom.getTime()).toBeLessThanOrEqual(esperado + 5_000);
    // Dos consultas, una sola ida a la base, y por la vía que fija el tenant.
    expect($queryRaw).toHaveBeenCalledTimes(2);
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it('devuelve las incidencias tal como las agrupa la base', async () => {
    const incident = {
      code: 'PDF_EXTRACTION_FAILED',
      message: 'No fue posible leer la estructura del PDF.',
      count: 33,
      lastOccurredAt: new Date('2026-08-06T03:09:03.293Z'),
      lastRequestId: '2a82ba9d',
      lastCorrelationId: 'a41eaf39',
      lastAttemptCount: 1,
    };
    const { service } = build({ total: 33, failed: 33 }, [incident]);

    const { incidents } = await service.collect(1n, 'bank-statement', 24);

    expect(incidents).toEqual([incident]);
  });
});

describe('superficie HTTP de las métricas', () => {
  const config = new ConfigService({
    BANK_STATEMENT_WORKER_ENABLED: true,
    SEMANTIC_ANALYSIS_WORKER_ENABLED: true,
    SEMANTIC_ANALYSIS_PROVIDER: 'transformer',
  });

  function controller(collect = jest.fn()) {
    const metrics = { collect } as unknown as WorkerMetricsService;
    return new WorkersController(config, metrics);
  }

  it('un código que este motor no publica es un 404, no un panel vacío', async () => {
    await expect(
      controller().workerMetrics(1n, 'inventado', { windowHours: 24 }),
    ).rejects.toMatchObject({ code: 'WORKER_NOT_FOUND', status: 404 });
  });

  it('adjunta el nombre y la disponibilidad del catálogo, sin una segunda llamada', async () => {
    const collect = jest.fn().mockResolvedValue({ totalRuns: 0, incidents: [] });

    const result = await controller(collect).workerMetrics(1n, 'bank-statement', {
      windowHours: 24,
    });

    // El panel necesita las dos cosas a la vez —«¿está encendido?» y «¿cómo le
    // va?»—; servirlas por separado obligaría a encadenar dos peticiones para
    // pintar una sola pantalla.
    expect(result.name).toBe('Extractos bancarios');
    expect(result.available).toBe(true);
    expect(result.windowHours).toBe(24);
    expect(collect).toHaveBeenCalledWith(1n, 'bank-statement', 24);
  });

  it('un worker apagado se declara apagado, y sus métricas se sirven igual', async () => {
    const apagado = new ConfigService({ BANK_STATEMENT_WORKER_ENABLED: false });
    const metrics = {
      collect: jest.fn().mockResolvedValue({ totalRuns: 7, incidents: [] }),
    } as unknown as WorkerMetricsService;

    const result = await new WorkersController(apagado, metrics).workerMetrics(
      1n,
      'bank-statement',
      {
        windowHours: 24,
      },
    );

    // Apagarlo no borra lo que hizo: el historial es justo lo que se consulta
    // cuando alguien pregunta por qué se apagó.
    expect(result.available).toBe(false);
    expect(result.totalRuns).toBe(7);
  });
});
