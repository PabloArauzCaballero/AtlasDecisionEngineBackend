import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { AuditService } from '../src/common/audit/audit.service';
import { EventBus } from '../src/common/events/event-bus';
import { DecisionEventType } from '../src/common/events/event-types';
import { OutboxPublisherService } from '../src/common/events/outbox-publisher.service';
import type { JobSchedulerService } from '../src/common/jobs/job-scheduler.service';
import type { JobSignalService } from '../src/common/jobs/job-signal.service';
import { MessagingTraceService } from '../src/common/observability/messaging-trace.service';
import type { MetricsService } from '../src/common/observability/metrics.service';
import { TracingService } from '../src/common/observability/tracing.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { AtlasCallbackDispatcher } from '../src/modules/atlas-callback/atlas-callback.dispatcher';
import { NotificationProjectorService } from '../src/modules/notifications/notification-projector.service';
import { NotificationService } from '../src/modules/notifications/notification.service';
import { OutboxRelayService } from '../src/modules/outbox-relay/outbox-relay.service';
import { uniqueTenantId } from './support/unique-tenant';

/**
 * Los dos avisos que el motor perdía, recorridos contra una base de verdad: la fila del outbox,
 * el relay que la reclama, el consumidor, y lo que queda escrito después.
 *
 * - P1-7: un aviso a AtlasBackend SIN configuración se marcaba procesado y el relay lo pasaba a
 *   DISPATCHED. Aquí se exige lo contrario: la fila sigue PENDING con el motivo en `last_error`,
 *   sin marca de procesado, y agotados los intentos pasa a DEAD —visible y reprocesable—.
 * - P1-6: `MONITORING_BREACH_DETECTED` llegaba al proyector y no producía nada. Aquí se exige la
 *   notificación en la bandeja de riesgo y en la de cumplimiento.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('Outbox: avisos que ya no se pierden (integración)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });
  const metrics = {
    setOutboxPending: jest.fn(),
    recordOutboxDispatched: jest.fn(),
    recordOutboxDead: jest.fn(),
    recordNotificationCreated: jest.fn(),
  } as unknown as MetricsService;
  const jobSignal = {
    notify: jest.fn().mockResolvedValue(undefined),
  } as unknown as JobSignalService;
  const trace = new MessagingTraceService(new TracingService());
  const publisher = new OutboxPublisherService(jobSignal, trace);
  const scheduler = { register: jest.fn() } as unknown as JobSchedulerService;
  const audit = { append: jest.fn().mockResolvedValue({}) } as unknown as AuditService;
  const tenantId = uniqueTenantId(73);

  function relayWith(bus: EventBus, maxAttempts: number): OutboxRelayService {
    const config = new ConfigService({
      OUTBOX_MAX_ATTEMPTS: maxAttempts,
      OUTBOX_BATCH_SIZE: 25,
      // El retroceso sale de este intervalo; a cero, el reintento vence en el acto y la prueba
      // no tiene que esperar para volver a reclamar la fila.
      OUTBOX_RELAY_INTERVAL_MS: 0,
    });
    return new OutboxRelayService(
      prisma as unknown as PrismaService,
      bus,
      config,
      metrics,
      scheduler,
      trace,
    );
  }

  async function publicarAviso(): Promise<bigint> {
    const row = await prisma.$transaction((tx) =>
      publisher.publish(tx, {
        eventType: DecisionEventType.ATLAS_CALLBACK_REQUESTED,
        tenantId,
        aggregateType: 'ManualReviewCase',
        aggregateId: '77',
        actorId: 'ana',
        payload: {
          route: '/internal/identity/manual-review-callback',
          body: { executionId: '555', decision: 'APPROVE' },
        },
      }),
    );
    return row.id;
  }

  async function marcaDe(outboxEventId: bigint) {
    return prisma.processedEvent.findUnique({
      where: {
        consumerName_outboxEventId: {
          consumerName: AtlasCallbackDispatcher.CONSUMER_NAME,
          outboxEventId,
        },
      },
    });
  }

  afterEach(async () => {
    await prisma.notification.deleteMany({ where: { tenantId } });
    await prisma.decisionOutboxEvent.deleteMany({ where: { tenantId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('sin configuración, el aviso a AtlasBackend queda PENDIENTE y luego DEAD, nunca consumido', async () => {
    const bus = new EventBus();
    const dispatcher = new AtlasCallbackDispatcher(
      prisma as unknown as PrismaService,
      bus,
      audit,
      new ConfigService({ WORKER_ROLE: 'ALL' }),
    );
    dispatcher.onModuleInit();
    const id = await publicarAviso();

    await relayWith(bus, 2).dispatchBatch();
    const pendiente = await prisma.decisionOutboxEvent.findUniqueOrThrow({ where: { id } });
    expect(pendiente.status).toBe('PENDING');
    expect(pendiente.lastError).toContain('falta ATLAS_BACKEND_BASE_URL y ENGINE_CALLBACK_API_KEY');
    expect(await marcaDe(id)).toBeNull();

    await relayWith(bus, 2).dispatchBatch();
    const muerto = await prisma.decisionOutboxEvent.findUniqueOrThrow({ where: { id } });
    expect(muerto.status).toBe('DEAD');
    expect(metrics.recordOutboxDead).toHaveBeenCalledWith(
      DecisionEventType.ATLAS_CALLBACK_REQUESTED,
    );
    // Sin marca: al reencolarlo (docs/events/retries-and-dlq.md) la deduplicación no lo descarta.
    expect(await marcaDe(id)).toBeNull();
    dispatcher.onModuleDestroy();
  });

  it('con la renuncia declarada se consume a sabiendas', async () => {
    const bus = new EventBus();
    const dispatcher = new AtlasCallbackDispatcher(
      prisma as unknown as PrismaService,
      bus,
      audit,
      new ConfigService({ WORKER_ROLE: 'ALL', ATLAS_CALLBACK_DISABLED: true }),
    );
    dispatcher.onModuleInit();
    const id = await publicarAviso();

    await relayWith(bus, 8).dispatchBatch();

    const fila = await prisma.decisionOutboxEvent.findUniqueOrThrow({ where: { id } });
    expect(fila.status).toBe('DISPATCHED');
    expect(await marcaDe(id)).not.toBeNull();
    dispatcher.onModuleDestroy();
  });

  it('un BREACH de la vigilancia llega a la bandeja de riesgo y de cumplimiento', async () => {
    const bus = new EventBus();
    const notifications = new NotificationService(
      prisma as unknown as PrismaService,
      new ConfigService({ MAX_PAGE_SIZE: 100 }),
      metrics,
    );
    const projector = new NotificationProjectorService(
      prisma as unknown as PrismaService,
      bus,
      notifications,
      new ConfigService({ WORKER_ROLE: 'ALL' }),
    );
    projector.onModuleInit();
    const row = await prisma.$transaction((tx) =>
      publisher.publish(tx, {
        eventType: DecisionEventType.MONITORING_BREACH_DETECTED,
        tenantId,
        aggregateType: 'MonitoringEvaluation',
        aggregateId: '91',
        actorId: 'monitoring-evaluation',
        payload: {
          artifactCode: 'CREDIT-RISK',
          metricCode: 'ADVERSE_IMPACT_RATIO',
          scope: 'gender:F',
          value: 0.71,
          threshold: 0.8,
          sampleSize: 240,
        },
      }),
    );

    await relayWith(bus, 8).dispatchBatch();

    expect(
      (await prisma.decisionOutboxEvent.findUniqueOrThrow({ where: { id: row.id } })).status,
    ).toBe('DISPATCHED');
    for (const role of ['RISK_ANALYST', 'COMPLIANCE']) {
      const inbox = await notifications.list(
        tenantId,
        { principalId: `${role.toLowerCase()}@atlas.test`, roles: [role] },
        { pageSize: 25 } as never,
      );
      expect(inbox.items).toHaveLength(1);
      expect(inbox.items[0]).toMatchObject({
        category: 'MONITORING',
        priority: 'HIGH',
        title: 'Modelo fuera de umbral: CREDIT-RISK',
        actionUrl: '/model-monitoring',
      });
    }
    // Quien carga desenlaces (OPERATIONS) no lee los análisis de degradación: no se le avisa.
    const operations = await notifications.list(
      tenantId,
      { principalId: 'ops@atlas.test', roles: ['OPERATIONS'] },
      { pageSize: 25 } as never,
    );
    expect(operations.items).toHaveLength(0);
    projector.onModuleDestroy();
  });
});
