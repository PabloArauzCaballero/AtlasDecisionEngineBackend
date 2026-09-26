import { SpanKind, SpanStatusCode, context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import { CompositePropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { DomainException } from '../src/common/errors/domain-exception';
import { MessagingTraceService } from '../src/common/observability/messaging-trace.service';
import { TRACE_CARRIER_KEY } from '../src/common/observability/telemetry.constants';
import { readActiveTraceIds } from '../src/common/observability/trace-context.service';
import { TraceContextService } from '../src/common/observability/trace-context.service';
import { TracingService } from '../src/common/observability/tracing.service';

/**
 * Se traza contra un exportador EN MEMORIA, no contra Jaeger.
 *
 * Estas pruebas verifican la lógica propia del motor —que el span se cierre siempre, que el
 * error se marque una vez, que el contexto sobreviva a un salto entre procesos—, y eso no
 * necesita red. Depender de un Jaeger vivo aquí las volvería lentas e intermitentes por
 * motivos que no tienen nada que ver con lo que prueban. El camino de extremo a extremo se
 * verifica aparte, con `yarn jaeger:verify`.
 */
const exporter = new InMemorySpanExporter();
let provider: BasicTracerProvider;
const contextManager = new AsyncLocalStorageContextManager();

beforeAll(() => {
  provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  trace.setGlobalTracerProvider(provider);
  // Sin gestor de contexto, la API usa el `NoopContextManager` y `context.active()` siempre
  // devuelve el contexto raíz: los spans se crearían sueltos, sin padre, y la propagación no
  // tendría nada que inyectar. En producción lo registra el `NodeSDK`; aquí hay que hacerlo.
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
});

beforeEach(() => exporter.reset());

function finished(): ReadableSpan[] {
  return exporter.getFinishedSpans();
}

function only(): ReadableSpan {
  const spans = finished();
  expect(spans).toHaveLength(1);
  return spans[0];
}

describe('TracingService', () => {
  const tracing = new TracingService();

  it('ejecuta la operación, finaliza el span y devuelve su resultado', async () => {
    const result = await tracing.runInSpan(
      'decision.execute',
      { 'app.module': 'runtime' },
      () => 42,
    );

    expect(result).toBe(42);
    const span = only();
    expect(span.name).toBe('decision.execute');
    expect(span.ended).toBe(true);
    expect(span.attributes['app.module']).toBe('runtime');
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('soporta una operación asíncrona y mide el trabajo real, no el tiempo hasta la promesa', async () => {
    await tracing.runInSpan('decision.execute', {}, async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return 'listo';
    });

    const span = only();
    const durationMs = span.duration[0] * 1_000 + span.duration[1] / 1_000_000;
    expect(durationMs).toBeGreaterThanOrEqual(20);
  });

  it('registra la excepción, marca el span como error y RELANZA sin alterar el error', async () => {
    const original = new DomainException('RUNTIME_EXECUTION_FAILED', 'el motor falló', 422);

    await expect(
      tracing.runInSpan('decision.execute', {}, () => Promise.reject(original)),
    ).rejects.toBe(original);

    const span = only();
    expect(span.ended).toBe(true);
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    // El CÓDIGO estable, nunca el mensaje: puede llevar fragmentos de la solicitud.
    expect(span.status.message).toBe('RUNTIME_EXECUTION_FAILED');
    expect(span.attributes['error.type']).toBe('RUNTIME_EXECUTION_FAILED');
    expect(span.events.filter((event) => event.name === 'exception')).toHaveLength(1);
  });

  it('finaliza el span también cuando la operación es síncrona y lanza', async () => {
    await expect(
      tracing.runInSpan('decision.execute', {}, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(only().ended).toBe(true);
  });

  it('anida los spans hijos bajo el padre activo', async () => {
    await tracing.runInSpan('decision.execute', {}, async () => {
      await tracing.runInSpan('outbox.publish', {}, () => undefined);
    });

    const [child, parent] = finished();
    expect(child.name).toBe('outbox.publish');
    expect(parent.name).toBe('decision.execute');
    expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
    expect(child.spanContext().traceId).toBe(parent.spanContext().traceId);
    expect(child.spanContext().spanId).not.toBe(parent.spanContext().spanId);
  });

  it('runInRootSpan abre una traza NUEVA aunque haya uno activo', async () => {
    await tracing.runInSpan('decision.execute', {}, async () => {
      await tracing.runInRootSpan('job.run', {}, () => undefined);
    });

    const [root, outer] = finished();
    expect(root.name).toBe('job.run');
    expect(root.parentSpanContext).toBeUndefined();
    expect(root.spanContext().traceId).not.toBe(outer.spanContext().traceId);
  });

  it('marca un error gestionado sin propagar mediante recordException', async () => {
    await tracing.runInSpan('decision.execute', {}, () => {
      tracing.recordException(new DomainException('VARIABLE_MISSING', 'falta', 422));
    });

    expect(only().status.code).toBe(SpanStatusCode.ERROR);
  });

  it('no hace nada al anotar fuera de todo span, en vez de fallar', () => {
    expect(() => tracing.setAttribute('app.module', 'runtime')).not.toThrow();
    expect(() => tracing.addEvent('hito')).not.toThrow();
    expect(tracing.getActiveSpan()).toBeUndefined();
    expect(finished()).toHaveLength(0);
  });
});

describe('TraceContextService', () => {
  const tracing = new TracingService();
  const contextService = new TraceContextService();

  it('devuelve los identificadores del span en curso', async () => {
    let observed: ReturnType<typeof readActiveTraceIds> | undefined;
    await tracing.runInSpan('decision.execute', {}, () => {
      observed = contextService.getActiveIds();
    });

    const span = only();
    expect(observed?.traceId).toBe(span.spanContext().traceId);
    expect(observed?.spanId).toBe(span.spanContext().spanId);
    expect(observed?.traceFlags).toBe(span.spanContext().traceFlags);
  });

  it('devuelve valores vacíos sin span activo y NO inventa identificadores', () => {
    expect(contextService.getActiveTraceId()).toBeUndefined();
    expect(contextService.getActiveSpanId()).toBeUndefined();
    expect(contextService.getActiveIds()).toEqual({
      traceId: undefined,
      spanId: undefined,
      traceFlags: undefined,
    });
  });
});

describe('MessagingTraceService', () => {
  const tracing = new TracingService();
  const messaging = new MessagingTraceService(tracing);

  it('inyecta traceparent cuando hay traza activa', async () => {
    let carrier: Record<string, string> = {};
    await tracing.runInSpan('outbox.publish', {}, () => {
      carrier = messaging.inject();
    });

    expect(carrier.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
    expect(carrier.traceparent).toContain(only().spanContext().traceId);
  });

  it('devuelve un portador vacío sin traza activa: es un caso normal, no un error', () => {
    expect(messaging.inject()).toEqual({});
  });

  it('mantiene la relación padre-hijo a través del portador, como si cruzara de proceso', async () => {
    let carrier: Record<string, string> = {};
    await tracing.runInSpan('outbox.publish', {}, () => {
      carrier = messaging.inject();
    });
    const producer = only();
    exporter.reset();

    // Fuera de todo contexto activo: es exactamente la situación del worker, que reclama la
    // fila en otro proceso y minutos después.
    await messaging.runAsConsumer('outbox.dispatch', carrier, {}, () => undefined);

    const consumer = only();
    expect(consumer.spanContext().traceId).toBe(producer.spanContext().traceId);
    expect(consumer.parentSpanContext?.spanId).toBe(producer.spanContext().spanId);
    expect(consumer.kind).toBe(SpanKind.CONSUMER);
  });

  it('abre el span productor con SpanKind.PRODUCER', async () => {
    await messaging.runAsProducer('outbox.publish', {}, () => undefined);
    expect(only().kind).toBe(SpanKind.PRODUCER);
  });

  it('procesa un mensaje ANTIGUO sin portador abriendo una traza raíz', async () => {
    await messaging.runAsConsumer('outbox.dispatch', null, {}, () => 'procesado');

    const span = only();
    expect(span.parentSpanContext).toBeUndefined();
    expect(span.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('tolera metadata incompleta o manipulada sin perder el trabajo', async () => {
    for (const broken of [{}, { traceparent: 42 }, { [TRACE_CARRIER_KEY]: 'no-es-un-mapa' }, []]) {
      exporter.reset();
      await expect(
        messaging.runAsConsumer('outbox.dispatch', broken, {}, () => 'ok'),
      ).resolves.toBe('ok');
      expect(only().parentSpanContext).toBeUndefined();
    }
  });

  it('acepta el portador envuelto bajo la clave del sobre', async () => {
    let carrier: Record<string, string> = {};
    await tracing.runInSpan('outbox.publish', {}, () => {
      carrier = messaging.inject();
    });
    const producer = only();
    exporter.reset();

    await messaging.runAsConsumer(
      'outbox.dispatch',
      { [TRACE_CARRIER_KEY]: carrier },
      {},
      () => undefined,
    );

    expect(only().spanContext().traceId).toBe(producer.spanContext().traceId);
  });

  it('withCarrier no modifica destructivamente el mensaje de dominio', async () => {
    const message = { requestId: 'req-1', text: 'contenido' };
    await tracing.runInSpan('outbox.publish', {}, () => {
      const envelope = messaging.withCarrier(message);
      expect(envelope.requestId).toBe('req-1');
      expect(envelope[TRACE_CARRIER_KEY]).toBeDefined();
    });

    expect(message).toEqual({ requestId: 'req-1', text: 'contenido' });
  });

  it('extract sin portador devuelve el contexto activo, no uno inventado', () => {
    expect(messaging.extract(undefined)).toBe(context.active());
  });
});
