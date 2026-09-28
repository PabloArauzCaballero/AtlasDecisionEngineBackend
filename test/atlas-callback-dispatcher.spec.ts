import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { AuditService } from '../src/common/audit/audit.service';
import { EventBus } from '../src/common/events/event-bus';
import type { DispatchedEvent } from '../src/common/events/event-envelope';
import { DecisionEventType } from '../src/common/events/event-types';
import type { OutboxPublisherService } from '../src/common/events/outbox-publisher.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { AtlasCallbackDispatcher } from '../src/modules/atlas-callback/atlas-callback.dispatcher';
import { AtlasCallbackService } from '../src/modules/atlas-callback/atlas-callback.service';

/**
 * El aviso de vuelta a AtlasBackend (A7).
 *
 * Antes era un `fetch` después del commit: si AtlasBackend no contestaba —bastaba con que
 * estuviera desplegando—, el fallo se anotaba y la decisión de la persona se perdía para Atlas.
 * Lo que se fija aquí es lo que hace real el reintento: un fallo pasajero LANZA (el relay deja la
 * fila pendiente con retroceso), uno definitivo no, y un aviso ya entregado no se repite.
 */
describe('AtlasCallbackDispatcher', () => {
  const RUTA = '/internal/identity/manual-review-callback';
  const CUERPO = {
    executionId: '555',
    decision: 'APPROVE',
    reason: 'ok',
    resolvedByInternalUserId: 'ana',
  };
  const fetchOriginal = global.fetch;

  function evento(over: Partial<DispatchedEvent> = {}): DispatchedEvent {
    return {
      outboxEventId: 42n,
      eventType: DecisionEventType.ATLAS_CALLBACK_REQUESTED,
      schemaVersion: '1',
      tenantId: 3n,
      aggregateType: 'ManualReviewCase',
      aggregateId: '77',
      actorId: 'ana',
      correlationId: 'req-9',
      causationId: null,
      occurredAt: new Date('2026-09-27T12:00:00Z'),
      payload: { route: RUTA, body: CUERPO },
      ...over,
    };
  }

  function montar(
    opciones: {
      entregado?: boolean;
      config?: Record<string, string>;
      rol?: string;
    } = {},
  ) {
    const marcas: unknown[] = [];
    const prisma = {
      processedEvent: {
        findUnique: jest.fn(async () => (opciones.entregado ? { id: 1n } : null)),
        createMany: jest.fn(async (args: { data: unknown[] }) => {
          marcas.push(...args.data);
          return { count: 1 };
        }),
      },
    } as unknown as PrismaService;
    const auditados: Array<Record<string, unknown>> = [];
    const audit = {
      append: jest.fn(async (input: Record<string, unknown>) => {
        auditados.push(input);
        return {};
      }),
    } as unknown as AuditService;
    const bus = new EventBus();
    const config = new ConfigService({
      ATLAS_BACKEND_BASE_URL: 'http://atlas-backend:3000/',
      ENGINE_CALLBACK_API_KEY: 'clave-del-motor',
      WORKER_ROLE: opciones.rol ?? 'ALL',
      ...(opciones.config ?? {}),
    });
    const dispatcher = new AtlasCallbackDispatcher(prisma, bus, audit, config);
    return { dispatcher, marcas, auditados, bus, prisma };
  }

  function responder(status: number, texto = '') {
    const fetchMock = jest.fn(async (..._args: unknown[]) => new Response(texto, { status }));
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  it('llama a AtlasBackend con la clave, el tenant y el cuerpo, y marca el aviso como entregado', async () => {
    const fetchMock = responder(200, '{"applied":true}');
    const { dispatcher, marcas, auditados } = montar();

    await dispatcher.handle(evento());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // La barra final de la base no duplica la de la ruta.
    expect(url).toBe(`http://atlas-backend:3000${RUTA}`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'x-tenant-id': '3',
      'x-engine-callback-key': 'clave-del-motor',
    });
    expect(JSON.parse(String(init.body))).toEqual(CUERPO);
    expect(marcas).toEqual([{ consumerName: 'atlas-callback', outboxEventId: 42n }]);
    expect(auditados).toHaveLength(0);
  });

  it.each([500, 502, 503, 408, 429])(
    'un %s es pasajero: se audita y LANZA para que el relay lo reintente',
    async (status) => {
      responder(status, 'desplegando');
      const { dispatcher, marcas, auditados } = montar();

      await expect(dispatcher.handle(evento())).rejects.toThrow(/pendiente/);

      expect(marcas).toHaveLength(0);
      expect(auditados).toHaveLength(1);
      expect(auditados[0]).toMatchObject({
        tenantId: 3n,
        eventType: 'MANUAL_REVIEW_CALLBACK_FAILED',
        aggregateType: 'ManualReviewCase',
        aggregateId: '77',
        requestId: 'req-9',
        payload: expect.objectContaining({ ruta: RUTA, permanente: false, executionId: '555' }),
      });
    },
  );

  it('un fallo de red también es pasajero', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const { dispatcher, marcas } = montar();

    await expect(dispatcher.handle(evento())).rejects.toThrow(/ECONNREFUSED/);
    expect(marcas).toHaveLength(0);
  });

  it.each([400, 401, 404])('un %s es definitivo: se audita y NO se reintenta', async (status) => {
    responder(status, 'Ningun intento de identidad nacio de la ejecucion 555.');
    const { dispatcher, marcas, auditados } = montar();

    await expect(dispatcher.handle(evento())).resolves.toBeUndefined();

    expect(auditados[0]).toMatchObject({
      payload: expect.objectContaining({ permanente: true }),
    });
    expect(marcas).toHaveLength(1);
  });

  it('un aviso ya entregado no se vuelve a mandar aunque el relay lo reparta otra vez', async () => {
    const fetchMock = responder(200);
    const { dispatcher } = montar({ entregado: true });

    await dispatcher.handle(evento());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sin base o sin clave no llama, no reintenta y lo deja escrito', async () => {
    const fetchMock = responder(200);
    const { dispatcher, marcas } = montar({ config: { ENGINE_CALLBACK_API_KEY: '' } });

    await dispatcher.handle(evento());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(marcas).toHaveLength(1);
  });

  it('un evento sin ruta o sin cuerpo se descarta sin llamar', async () => {
    const fetchMock = responder(200);
    const { dispatcher } = montar();

    await dispatcher.handle(evento({ payload: { body: CUERPO } }));
    await dispatcher.handle(evento({ payload: { route: 'sin-barra', body: CUERPO } }));
    await dispatcher.handle(evento({ payload: { route: RUTA, body: ['x'] } }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('se suscribe al evento donde corre el relay, y a ningún otro', async () => {
    const fetchMock = responder(200);
    const { dispatcher, bus } = montar();
    dispatcher.onModuleInit();

    expect(bus.hasSubscribers(DecisionEventType.ATLAS_CALLBACK_REQUESTED)).toBe(true);
    expect(bus.hasSubscribers(DecisionEventType.VERSION_APPROVED)).toBe(false);
    await bus.emit(evento());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    dispatcher.onModuleDestroy();
    expect(bus.hasSubscribers(DecisionEventType.ATLAS_CALLBACK_REQUESTED)).toBe(false);
  });

  it('en una réplica de API no se suscribe: allí el bus no emite nunca', () => {
    const { dispatcher, bus } = montar({ rol: 'API' });
    dispatcher.onModuleInit();
    expect(bus.hasSubscribers(DecisionEventType.ATLAS_CALLBACK_REQUESTED)).toBe(false);
  });
});

describe('AtlasCallbackService', () => {
  it('escribe el aviso en el outbox con la transacción de quien resuelve', async () => {
    const publish = jest.fn(async () => ({}));
    const service = new AtlasCallbackService({ publish } as unknown as OutboxPublisherService);
    const tx = {} as Prisma.TransactionClient;

    await service.solicitar(tx, {
      tenantId: 3n,
      ruta: '/internal/credit/bank-statement-review-callback',
      cuerpo: { requestId: 'bs-1', status: 'SUCCEEDED' },
      aggregateType: 'BankStatementRun',
      aggregateId: 'bs-1',
      actorId: 'ana',
      correlationId: 'req-1',
    });

    expect(publish).toHaveBeenCalledWith(tx, {
      eventType: 'atlas.callback_requested',
      tenantId: 3n,
      aggregateType: 'BankStatementRun',
      aggregateId: 'bs-1',
      actorId: 'ana',
      correlationId: 'req-1',
      payload: {
        route: '/internal/credit/bank-statement-review-callback',
        body: { requestId: 'bs-1', status: 'SUCCEEDED' },
      },
    });
  });
});
