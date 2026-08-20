import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
import { W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import { CompositePropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_SERVICE_NAMESPACE,
} from '@opentelemetry/semantic-conventions';
import { readTelemetryConfig } from './telemetry.config';
import { buildInstrumentations } from './telemetry.instrumentations';
import type { TelemetryConfig } from './telemetry.types';

/**
 * Arranque del SDK de OpenTelemetry. Opt-in e inerte mientras no se habilite.
 *
 * Este módulo se importa por su efecto secundario **antes que ningún otro** en `main.ts` y
 * `worker.ts`: las instrumentaciones parchean `http`, `express`, `pg`, `ioredis` y `undici` en
 * el instante en que esos módulos se requieren, así que arrancar el SDK después de que Nest los
 * haya cargado produce cero spans y ningún error que lo explique.
 *
 * Lee `process.env` y no `ConfigService` porque corre antes de que exista el contenedor de
 * NestJS. Con `OTEL_ENABLED` apagado el despliegue no paga nada: ni exportador, ni parcheo, ni
 * conexiones de fondo.
 *
 * La aplicación **nunca** depende de que el destino de trazas esté disponible: la exportación
 * es asíncrona y un colector inalcanzable sólo pierde spans.
 */
let sdk: NodeSDK | undefined;
let activeConfig: TelemetryConfig | undefined;

/**
 * Arranca la telemetría si está habilitada. Idempotente: una segunda llamada no hace nada, lo
 * que importa en las pruebas, donde varios módulos pueden alcanzar este arranque.
 *
 * @param defaultServiceName - Nombre a usar si no hay `OTEL_SERVICE_NAME`. Cada proceso pasa el
 *   suyo: reutilizar el nombre del API en el worker haría inservible el grafo de dependencias.
 */
export function startTracing(defaultServiceName?: string): void {
  if (sdk) return;
  const config = readTelemetryConfig(process.env, defaultServiceName);
  if (!config.enabled) return;

  diag.setLogger(new DiagConsoleLogger(), toDiagLevel(config.diagLogLevel));

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_NAMESPACE]: config.serviceNamespace,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
      'deployment.environment.name': config.deploymentEnvironment,
    }),
    // Sin endpoint configurado se usa el destino OTLP por defecto (localhost:4318), que es la
    // convención del colector como sidecar.
    traceExporter: new OTLPTraceExporter({
      url: config.tracesEndpoint,
      timeoutMillis: config.exportTimeoutMs,
    }),
    // Basado en el padre: si un servicio aguas arriba ya decidió muestrear una traza, se
    // respeta su decisión, porque media traza no sirve para nada. La proporción sólo gobierna
    // las trazas que nacen aquí.
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.samplerRatio) }),
    textMapPropagator: buildPropagator(config),
    instrumentations: buildInstrumentations(config),
  });

  sdk.start();
  activeConfig = config;
}

/**
 * Vacía y detiene el exportador. **Nunca lanza**: perder spans no puede convertir un apagado
 * limpio en una caída.
 */
export async function stopTracing(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch (error) {
    // Se informa por el canal de diagnóstico de OpenTelemetry, no se silencia: un vaciado que
    // falla siempre es una pérdida de evidencia y debe poder verse.
    diag.error('Fallo al vaciar el exportador de trazas', error);
  } finally {
    sdk = undefined;
    activeConfig = undefined;
  }
}

/** Configuración con la que arrancó el SDK, o `undefined` si la telemetría está apagada. */
export function activeTelemetryConfig(): TelemetryConfig | undefined {
  return activeConfig;
}

/**
 * Compone los propagadores declarados.
 *
 * Sólo W3C: `tracecontext` es el estándar y `baggage` lo acompaña. B3 se reconoce para poder
 * avisar, pero no se implementa — no hay ningún consumidor heredado que lo exija y añadirlo
 * sólo engordaría las cabeceras de cada petición saliente.
 */
function buildPropagator(config: TelemetryConfig): CompositePropagator {
  const propagators = [];
  for (const name of config.propagators) {
    if (name === 'tracecontext') propagators.push(new W3CTraceContextPropagator());
    else if (name === 'baggage') propagators.push(new W3CBaggagePropagator());
    else diag.warn(`Propagador no soportado en OTEL_PROPAGATORS, ignorado: ${name}`);
  }
  // Una lista que sólo trajera nombres desconocidos dejaría el proceso sin propagación y
  // rompería la correlación entre servicios en silencio.
  if (propagators.length === 0) {
    propagators.push(new W3CTraceContextPropagator(), new W3CBaggagePropagator());
  }
  return new CompositePropagator({ propagators });
}

function toDiagLevel(level: string): DiagLogLevel {
  switch (level) {
    case 'NONE':
      return DiagLogLevel.NONE;
    case 'ERROR':
      return DiagLogLevel.ERROR;
    case 'WARN':
      return DiagLogLevel.WARN;
    case 'INFO':
      return DiagLogLevel.INFO;
    case 'DEBUG':
      return DiagLogLevel.DEBUG;
    case 'VERBOSE':
      return DiagLogLevel.VERBOSE;
    case 'ALL':
      return DiagLogLevel.ALL;
    default:
      return DiagLogLevel.ERROR;
  }
}
