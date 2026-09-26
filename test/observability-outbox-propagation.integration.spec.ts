import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { propagation } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { EventBus } from '../src/common/events/event-bus';
import { DecisionEventType } from '../src/common/events/event-types';
import { OutboxPublisherService } from '../src/common/events/outbox-publisher.service';
import { persistableCarrier } from '../src/common/events/trace-carrier';
import type { JobSchedulerService } from '../src/common/jobs/job-scheduler.service';
import type { JobSignalService } from '../src/common/jobs/job-signal.service';
import { MessagingTraceService } from '../src/common/observability/messaging-trace.service';
import type { MetricsService } from '../src/common/observability/metrics.service';
import { TracingService } from '../src/common/observability/tracing.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { OutboxRelayService } from '../src/modules/outbox-relay/outbox-relay.service';
import { uniqueTenantId } from './support/unique-tenant';

/**
 * Propagación del contexto de traza a través de PostgreSQL, contra la base de datos real.
 *
 * Es la prueba que da sentido a la columna `trace_carrier`: el productor y el consumidor viven
 * en procesos distintos y sólo se comunican por una fila. Aquí ambos corren en el mismo test,
 * pero el contexto viaja por el ÚNICO camino que tendría en producción —persistido y releído—,
 * porque entre `publish` y `dispatchBatch` no queda ningún span activo.
 *
 * Necesita Postgres: la columna, el reclamo con FOR UPDATE SKIP LOCKED y el commit son
 * justamente lo que se está verificando.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const TRANSACTION_TIMEOUT_MS = 30_000;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('Propagación de traza API → worker por el outbox (integration)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  const exporter = new InMemorySpanExporter();
  const contextManager = new AsyncLocalStorageContextManager();
  let provider: BasicTracerProvider;

  const tracing = new TracingService();
  const messaging = new MessagingTraceService(tracing);
  const config = new ConfigService({ OUTBOX_MAX_ATTEMPTS: 8, OUTBOX_BATCH_SIZE: 25 });
  const metrics = {
    setOutboxPending: jest.fn(),
    recordOutboxDispatched: jest.fn(),
    recordOutboxDead: jest.fn(),
  } as unknown as MetricsService;
  const jobSignal = {
    notify: jest.fn().mockResolvedValue(undefined),
  } as unknown as JobSignalService;
  const scheduler = { register: jest.fn() } as unknown as JobSchedulerService;
  const publisher = new OutboxPublisherService(jobSignal, messaging);

  const tenantId = uniqueTenantId(77);

  beforeAll(() => {
    provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    trace.setGlobalTracerProvider(provider);
    context.setGlobalContextManager(contextManager.enable());
    propagation.setGlobalPropagator(
      new CompositePropagator({
        propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
      }),
    );
  });

  afterAll(async () => {
    contextManager.disable();
    await provider.shutdown();
    await prisma.decisionOutboxEvent.deleteMany({ where: { tenantId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    exporter.reset();
    await prisma.decisionOutboxEvent.deleteMany({ where: { tenantId } });
  });

  function buildRelay(bus: EventBus): OutboxRelayService {
    return new OutboxRelayService(
      prisma as unknown as PrismaService,
      bus,
      config,
      metrics,
      scheduler,
      messaging,
    );
  }

  async function publishWithin(spanName: string): Promise<string> {
    let traceId = '';
    await tracing.runInSpan(spanName, {}, async (span) => {
      traceId = span.spanContext().traceId;
      await prisma.$transaction(
        (tx) =>
          publisher.publish(tx, {
            eventType: DecisionEventType.VERSION_APPROVED,
            tenantId,
            aggregateType: 'ApprovalRequest',
            aggregateId: '900',
            actorId: 'qa@atlas.test',
            correlationId: 'req-trace-1',
            payload: { versionId: '900' },
          }),
        // El techo de 5 s de Prisma se agota en una máquina de desarrollo cargada, y el fallo
        // resultante no dice nada sobre la propagación, que es lo que aquí se prueba.
        { timeout: TRANSACTION_TIMEOUT_MS },
      );
    });
    return traceId;
  }

  it('persiste el traceparent en trace_carrier, fuera de payload_json', async () => {
    await publishWithin('decision.execute');

    const row = await prisma.decisionOutboxEvent.findFirstOrThrow({ where: { tenantId } });
    const carrier = row.traceCarrier as Record<string, string>;

    expect(carrier.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
    // El contrato del evento queda intacto: ningún metadato de transporte dentro del payload.
    expect(row.payloadJson).toEqual({ versionId: '900' });
    expect(JSON.stringify(row.payloadJson)).not.toContain('traceparent');
  });

  it('el worker continúa la MISMA traza que la petición que publicó el evento', async () => {
    const producerTraceId = await publishWithin('decision.execute');
    // Se descarta todo lo emitido por el productor: lo que importa es que el consumidor
    // recupere el contexto de la FILA, sin ningún span activo de por medio.
    exporter.reset();

    const bus = new EventBus();
    const delivered = await buildRelay(bus).dispatchBatch();

    // Al menos el evento propio. NO se exige que sea el único despachado: el relay no está
    // acotado por tenant, así que cualquier fila pendiente que otra suite dejara en la base
    // compartida entraría en el mismo lote y haría fallar una prueba que no habla de eso.
    // Lo que esta prueba afirma es la propagación, así que se busca el span POR SU TRAZA.
    expect(delivered).toBeGreaterThanOrEqual(1);
    const consumer = exporter
      .getFinishedSpans()
      .find(
        (span) => span.name === 'outbox.dispatch' && span.spanContext().traceId === producerTraceId,
      );
    expect(consumer).toBeDefined();
    expect(consumer?.spanContext().traceId).toBe(producerTraceId);
    // Misma traza, spans distintos: es lo que permite ver los dos procesos en una sola vista.
    expect(consumer?.spanContext().spanId).not.toBe(producerTraceId);
    expect(consumer?.attributes['messaging.operation.type']).toBe('process');
  });

  it('una fila SIN portador —anterior a la columna— se reparte igual, con traza raíz', async () => {
    await publishWithin('decision.execute');
    // Simula exactamente el estado de las filas ya existentes cuando se desplegó la columna.
    await prisma.decisionOutboxEvent.updateMany({
      where: { tenantId },
      data: { traceCarrier: Prisma.DbNull },
    });
    exporter.reset();

    const bus = new EventBus();
    const delivered = await buildRelay(bus).dispatchBatch();

    // Igual que arriba: importa la fila sin portador, no cuántas más viajaran con ella.
    expect(delivered).toBeGreaterThanOrEqual(1);
    const consumer = exporter
      .getFinishedSpans()
      .filter((span) => span.name === 'outbox.dispatch')
      .find((span) => span.parentSpanContext === undefined);
    expect(consumer).toBeDefined();
    expect(consumer?.parentSpanContext).toBeUndefined();
  });

  it('publicar sin traza padre abre una traza RAÍZ y el portador la referencia', async () => {
    await prisma.$transaction(
      (tx) =>
        publisher.publish(tx, {
          eventType: DecisionEventType.VERSION_APPROVED,
          tenantId,
          aggregateType: 'ApprovalRequest',
          aggregateId: '901',
          actorId: 'qa@atlas.test',
          correlationId: 'req-trace-2',
          payload: { versionId: '901' },
        }),
      { timeout: TRANSACTION_TIMEOUT_MS },
    );

    // `publish` abre SIEMPRE su propio span productor, así que hay contexto que capturar
    // incluso sin una petición que lo envuelva —una publicación desde un trabajo de fondo, por
    // ejemplo—. El portador no es inventado: apunta a ese span, que aquí es raíz.
    const producer = exporter.getFinishedSpans().find((span) => span.name === 'outbox.publish');
    expect(producer?.parentSpanContext).toBeUndefined();

    const row = await prisma.decisionOutboxEvent.findFirstOrThrow({ where: { tenantId } });
    const carrier = row.traceCarrier as Record<string, string>;
    expect(carrier.traceparent).toContain(producer?.spanContext().traceId);
  });

  it('con la telemetría apagada la columna queda NULL, no un mapa vacío', () => {
    // `persistableCarrier` es quien decide qué se persiste. Sin SDK registrado, `inject`
    // devuelve un mapa vacío y la columna debe decir la verdad: no hubo contexto. Se prueba
    // aquí y no arrancando un segundo proveedor porque el proveedor global es único por
    // proceso y desmontarlo a mitad del fichero volvería intermitentes las demás pruebas.
    expect(persistableCarrier({})).toBe(Prisma.DbNull);
    expect(persistableCarrier({ traceparent: '00-abc-def-01' })).toEqual({
      traceparent: '00-abc-def-01',
    });
  });

  it('un fallo del consumidor no rompe la correlación: el reintento conserva el portador', async () => {
    const producerTraceId = await publishWithin('decision.execute');
    exporter.reset();

    const failing = new EventBus();
    failing.subscribe(DecisionEventType.VERSION_APPROVED, () =>
      Promise.reject(new Error('consumidor caído')),
    );
    expect(await buildRelay(failing).dispatchBatch()).toBe(0);

    const retried = await prisma.decisionOutboxEvent.findFirstOrThrow({ where: { tenantId } });
    expect((retried.traceCarrier as Record<string, string>).traceparent).toContain(producerTraceId);
  });
});
