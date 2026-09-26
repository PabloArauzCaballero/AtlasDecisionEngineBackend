import { HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, CallHandler, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { of, throwError } from 'rxjs';
import { DomainException } from '../src/common/errors/domain-exception';
import { DomainExceptionFilter } from '../src/common/errors/domain-exception.filter';
import { readTelemetryConfig } from '../src/common/observability/telemetry.config';
import { TRACE_ID_HEADER } from '../src/common/observability/telemetry.constants';
import { TraceResponseInterceptor } from '../src/common/observability/trace-response.interceptor';
import { TracingService } from '../src/common/observability/tracing.service';

const exporter = new InMemorySpanExporter();
let provider: BasicTracerProvider;
const contextManager = new AsyncLocalStorageContextManager();

beforeAll(() => {
  provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  trace.setGlobalTracerProvider(provider);
  context.setGlobalContextManager(contextManager.enable());
});

afterAll(async () => {
  contextManager.disable();
  await provider.shutdown();
});

beforeEach(() => exporter.reset());

interface FakeResponse {
  headers: Record<string, string>;
  headersSent: boolean;
  statusCode: number;
  setHeader(name: string, value: string): void;
  status(code: number): FakeResponse;
  json(body: unknown): void;
  body?: unknown;
}

function fakeResponse(headersSent = false): FakeResponse {
  const response: FakeResponse = {
    headers: {},
    headersSent,
    statusCode: 200,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
  return response;
}

function httpContext(
  response: FakeResponse,
  request: Record<string, unknown> = {},
): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'POST', originalUrl: '/v1/decisions', headers: {}, ...request }),
    }),
  } as unknown as ExecutionContext;
}

function handler(): CallHandler {
  return { handle: () => of({ ok: true }) };
}

describe('TraceResponseInterceptor', () => {
  const interceptor = new TraceResponseInterceptor();
  const tracing = new TracingService();

  it('publica x-trace-id con el identificador del span ACTIVO', async () => {
    const response = fakeResponse();

    await tracing.runInSpan('decision.execute', {}, () => {
      interceptor.intercept(httpContext(response), handler());
    });

    const span = exporter.getFinishedSpans()[0];
    expect(response.headers[TRACE_ID_HEADER]).toBe(span.spanContext().traceId);
    expect(response.headers[TRACE_ID_HEADER]).toMatch(/^[0-9a-f]{32}$/);
  });

  it('no falla ni inventa una cabecera cuando no hay span activo', () => {
    const response = fakeResponse();

    expect(() => interceptor.intercept(httpContext(response), handler())).not.toThrow();
    expect(response.headers[TRACE_ID_HEADER]).toBeUndefined();
  });

  it('no intenta escribir cabeceras sobre una respuesta ya enviada', async () => {
    const response = fakeResponse(true);

    await tracing.runInSpan('decision.execute', {}, () => {
      interceptor.intercept(httpContext(response), handler());
    });

    expect(response.headers[TRACE_ID_HEADER]).toBeUndefined();
  });

  it('conserva la respuesta intacta: no toca el cuerpo', (done) => {
    const response = fakeResponse();
    interceptor.intercept(httpContext(response), handler()).subscribe((value) => {
      expect(value).toEqual({ ok: true });
      done();
    });
  });

  it('deja pasar la excepción sin transformarla', (done) => {
    const response = fakeResponse();
    const boom = new Error('boom');
    interceptor
      .intercept(httpContext(response), { handle: () => throwError(() => boom) })
      .subscribe({
        error: (error) => {
          expect(error).toBe(boom);
          done();
        },
      });
  });
});

describe('DomainExceptionFilter y el span activo', () => {
  const tracing = new TracingService();
  const config = new ConfigService({ NODE_ENV: 'test' });

  function host(response: FakeResponse): ArgumentsHost {
    return {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ method: 'POST', originalUrl: '/v1/decisions', headers: {} }),
      }),
    } as unknown as ArgumentsHost;
  }

  async function catchWithin(
    exception: unknown,
  ): Promise<{ span: ReadableSpan; response: FakeResponse }> {
    const response = fakeResponse();
    const filter = new DomainExceptionFilter(config);
    await tracing.runInSpan('decision.execute', {}, () => {
      filter.catch(exception, host(response));
    });
    return { span: exporter.getFinishedSpans()[0], response };
  }

  it('marca el span como error ante un 5xx y conserva el código HTTP', async () => {
    const { span, response } = await catchWithin(new Error('fallo interno'));

    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes['error.type']).toBe('INTERNAL_ERROR');
    expect(response.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('NO marca como error un 4xx: es tráfico esperado, pero deja el código anotado', async () => {
    const { span, response } = await catchWithin(
      new DomainException('VARIABLE_MISSING_OR_INVALID', 'falta una variable', 422),
    );

    expect(span.status.code).toBe(SpanStatusCode.UNSET);
    expect(span.attributes['app.rejection.code']).toBe('VARIABLE_MISSING_OR_INVALID');
    expect(response.statusCode).toBe(422);
  });

  it('registra la excepción UNA sola vez, no una por capa', async () => {
    const { span } = await catchWithin(new Error('fallo interno'));

    expect(span.events.filter((event) => event.name === 'exception')).toHaveLength(1);
  });

  it('no finaliza el span que creó la instrumentación', async () => {
    const response = fakeResponse();
    const filter = new DomainExceptionFilter(config);
    let endedDuringCatch: boolean | undefined;

    await tracing.runInSpan('decision.execute', {}, () => {
      filter.catch(new Error('fallo interno'), host(response));
      endedDuringCatch = exporter.getFinishedSpans().length > 0;
    });

    expect(endedDuringCatch).toBe(false);
  });

  it('no deja el mensaje del error como descripción del estado: podría llevar datos de la solicitud', async () => {
    const { span } = await catchWithin(new Error('el solicitante 12345678 tiene ingresos 4200'));

    expect(span.status.message).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(span.attributes)).not.toContain('12345678');
  });

  it('publica x-trace-id en un rechazo de guard, donde el interceptor NO llega a correr', async () => {
    const response = fakeResponse();
    const filter = new DomainExceptionFilter(config);

    await tracing.runInSpan('decision.execute', {}, () => {
      // Un 401 lo produce un guard, antes de cualquier interceptor: si la cabecera dependiera
      // sólo de TraceResponseInterceptor, el usuario que llama a soporte no tendría nada que dar.
      filter.catch(new DomainException('UNAUTHENTICATED', 'sin credencial', 401), host(response));
    });

    const span = exporter.getFinishedSpans()[0];
    expect(response.statusCode).toBe(401);
    expect(response.headers[TRACE_ID_HEADER]).toBe(span.spanContext().traceId);
  });

  it('funciona sin span activo: la observabilidad no puede romper el manejo de errores', () => {
    const response = fakeResponse();
    const filter = new DomainExceptionFilter(config);

    expect(() => filter.catch(new Error('boom'), host(response))).not.toThrow();
    expect(response.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});

describe('readTelemetryConfig', () => {
  it('está apagada salvo que se habilite EXPLÍCITAMENTE', () => {
    expect(readTelemetryConfig({}).enabled).toBe(false);
    expect(readTelemetryConfig({ OTEL_ENABLED: 'false' }).enabled).toBe(false);
    expect(readTelemetryConfig({ OTEL_ENABLED: 'quizá' }).enabled).toBe(false);
    for (const raw of ['true', 'TRUE', ' 1 ', 'yes']) {
      expect(readTelemetryConfig({ OTEL_ENABLED: raw }).enabled).toBe(true);
    }
  });

  it('usa el nombre por proceso cuando no se declara OTEL_SERVICE_NAME', () => {
    expect(readTelemetryConfig({}, 'atlas-worker').serviceName).toBe('atlas-worker');
    expect(readTelemetryConfig({ OTEL_SERVICE_NAME: 'otro' }, 'atlas-worker').serviceName).toBe(
      'otro',
    );
  });

  it('acota la proporción de muestreo a [0,1] y cae a 1 ante un valor ilegible', () => {
    expect(readTelemetryConfig({ OTEL_TRACES_SAMPLER_ARG: '0.25' }).samplerRatio).toBe(0.25);
    expect(readTelemetryConfig({ OTEL_TRACES_SAMPLER_ARG: '5' }).samplerRatio).toBe(1);
    expect(readTelemetryConfig({ OTEL_TRACES_SAMPLER_ARG: '-2' }).samplerRatio).toBe(0);
    expect(readTelemetryConfig({ OTEL_TRACES_SAMPLER_ARG: 'medio' }).samplerRatio).toBe(1);
  });

  it('propaga W3C por defecto y respeta la lista declarada', () => {
    expect(readTelemetryConfig({}).propagators).toEqual(['tracecontext', 'baggage']);
    expect(readTelemetryConfig({ OTEL_PROPAGATORS: 'tracecontext' }).propagators).toEqual([
      'tracecontext',
    ]);
  });

  it('toma versión y entorno del artefacto cuando no se declaran aparte', () => {
    const config = readTelemetryConfig({ BUILD_VERSION: '2.4.0', NODE_ENV: 'staging' });
    expect(config.serviceVersion).toBe('2.4.0');
    expect(config.deploymentEnvironment).toBe('staging');
  });
});
