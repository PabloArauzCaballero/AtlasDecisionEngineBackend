import { afterEach, describe, expect, it, jest } from '@jest/globals';

// El doble evita que el SDK real instale hooks globales de require-in-the-middle y deje un
// worker de Jest colgado. Estas pruebas comprueban QUÉ SEÑALES se habilitan, no la exportación.
jest.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    shutdown: jest.fn(async () => undefined),
  })),
}));
jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({ OTLPTraceExporter: jest.fn() }));

import { startTracing, stopTracing } from '../src/common/observability/tracing';

/**
 * `NodeSDK` arranca un proveedor de MÉTRICAS y otro de REGISTROS cuando sus variables no están
 * declaradas: su valor por defecto es `otlp`, no `none`. Medido el 2026-09-19 con Jaeger de
 * destino, eso producía un `OTLPExporterError: Not Found` cada minuto y, peor, una señal que
 * sale del proceso sin pasar por `RedactingSpanProcessor`, que sólo actúa sobre spans.
 */
describe('señales que este backend no exporta', () => {
  afterEach(async () => {
    await stopTracing();
    delete process.env.OTEL_ENABLED;
    delete process.env.OTEL_METRICS_EXPORTER;
    delete process.env.OTEL_LOGS_EXPORTER;
  });

  it('declara `none` en métricas y registros al arrancar con la telemetría encendida', () => {
    process.env.OTEL_ENABLED = 'true';
    startTracing('prueba-senales');
    expect(process.env.OTEL_METRICS_EXPORTER).toBe('none');
    expect(process.env.OTEL_LOGS_EXPORTER).toBe('none');
  });

  it('no pisa la decisión de un operador que sí declaró un exportador', () => {
    process.env.OTEL_METRICS_EXPORTER = 'prometheus';
    process.env.OTEL_ENABLED = 'true';
    startTracing('prueba-senales-2');
    expect(process.env.OTEL_METRICS_EXPORTER).toBe('prometheus');
  });

  it('con la telemetría apagada no toca ninguna variable de entorno', () => {
    delete process.env.OTEL_ENABLED;
    startTracing('prueba-senales-3');
    expect(process.env.OTEL_METRICS_EXPORTER).toBeUndefined();
    expect(process.env.OTEL_LOGS_EXPORTER).toBeUndefined();
  });
});
