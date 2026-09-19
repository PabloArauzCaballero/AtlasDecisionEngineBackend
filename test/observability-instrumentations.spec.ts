import { describe, expect, it } from '@jest/globals';
import { ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { buildInstrumentations } from '../src/common/observability/telemetry.instrumentations';
import { readTelemetryConfig } from '../src/common/observability/telemetry.config';

const config = readTelemetryConfig({
  OTEL_ENABLED: 'true',
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://colector:4318/v1/traces',
});

/**
 * Se leen los hooks REALES de la instrumentación construida, no una copia de su lógica: una
 * prueba que reimplementa el hook pasa aunque el que se instala esté mal.
 */
function configuracionDe(nombre: string): Record<string, unknown> {
  const instrumentacion = buildInstrumentations(config).find((candidata) =>
    candidata.instrumentationName.includes(nombre),
  );
  if (instrumentacion === undefined)
    throw new Error(`No se construyó la instrumentación ${nombre}`);
  return instrumentacion.getConfig() as unknown as Record<string, unknown>;
}

describe('instrumentaciones automáticas del motor', () => {
  it('son exactamente cinco, declaradas una a una', () => {
    const nombres = buildInstrumentations(config)
      .map((instrumentacion) =>
        instrumentacion.instrumentationName.replace('@opentelemetry/instrumentation-', ''),
      )
      .sort();
    // Si esta lista crece sin querer —por volver a `auto-instrumentations-node`, por ejemplo—
    // la traza se llena de spans de `fs` y `dns` y deja de poder leerse.
    expect(nombres).toEqual(['express', 'http', 'ioredis', 'pg', 'undici']);
  });

  describe('exclusión de sondas', () => {
    const excluir = configuracionDe('http').ignoreIncomingRequestHook as (r: {
      url?: string;
    }) => boolean;

    it.each([
      ['/health', 'la sonda de vida'],
      ['/health/ready', 'sonda de preparación'],
      ['/metrics', 'scrape de Prometheus'],
      ['/health?verbose=1', 'con cadena de consulta'],
      ['/favicon.ico', 'ruido del navegador'],
    ])('excluye %s (%s)', (url) => {
      expect(excluir({ url })).toBe(true);
    });

    it.each(['/decisions', '/artifacts/current'])('NO excluye %s', (url) => {
      expect(excluir({ url })).toBe(false);
    });
  });

  describe('exclusión del propio exportador', () => {
    const excluirSaliente = configuracionDe('http').ignoreOutgoingRequestHook as (r: {
      hostname?: string | null;
      port?: number | string | null;
    }) => boolean;

    it('no traza sus propias exportaciones: si no, cada lote genera el span del siguiente', () => {
      expect(excluirSaliente({ hostname: 'colector', port: 4318 })).toBe(true);
    });

    it('sí traza las llamadas a cualquier otro destino', () => {
      expect(excluirSaliente({ hostname: 'proveedor', port: 443 })).toBe(false);
      expect(excluirSaliente({ hostname: 'colector', port: 9000 })).toBe(false);
    });

    it('sin endpoint configurado no excluye nada', () => {
      const sinDestino = buildInstrumentations(readTelemetryConfig({ OTEL_ENABLED: 'true' }));
      const hook = sinDestino
        .find((i) => i.instrumentationName.includes('http'))!
        .getConfig() as unknown as { ignoreOutgoingRequestHook: (r: unknown) => boolean };
      expect(hook.ignoreOutgoingRequestHook({ hostname: 'localhost', port: 4318 })).toBe(false);
    });
  });

  it('express no abre un span por cada middleware', () => {
    // Siete de los dieciocho spans de una petición eran middleware, cinco de ellos de 0,0 ms.
    expect(configuracionDe('express').ignoreLayersType).toEqual([ExpressLayerType.MIDDLEWARE]);
  });

  it('el serializador de Redis publica el comando y NUNCA sus argumentos', () => {
    const serializar = configuracionDe('ioredis').dbStatementSerializer as (
      c: string,
      a: unknown[],
    ) => string;
    expect(serializar('set', ['sesion:cliente:42', 'token-secreto'])).toBe('set');
  });

  it('pg no publica los valores de los parámetros ligados', () => {
    expect(configuracionDe('pg').enhancedDatabaseReporting).toBe(false);
  });
});
