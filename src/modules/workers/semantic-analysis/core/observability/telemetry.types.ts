import type { Attributes, Span } from '@opentelemetry/api';

/**
 * Portador del contexto de traza entre procesos. Es un mapa plano de cabeceras W3C
 * (`traceparent`, `tracestate`, `baggage`), que es lo que `propagation.inject` produce.
 */
export type TraceCarrier = Record<string, string>;

/** Identificadores de la traza activa. Vacíos cuando no hay span en curso; nunca inventados. */
export interface ActiveTraceIds {
  readonly traceId: string | undefined;
  readonly spanId: string | undefined;
  readonly traceFlags: number | undefined;
}

/**
 * Resultado de inicializar la telemetría. `enabled` en `false` indica que el SDK no se arrancó —
 * por configuración o por un fallo ya registrado — y que `shutdown` no tiene nada que vaciar.
 */
export interface TelemetryHandle {
  readonly enabled: boolean;
  shutdown(): Promise<void>;
}

export interface StartTelemetryOptions {
  /** Nombre de servicio cuando `OTEL_SERVICE_NAME` no está definido. */
  readonly defaultServiceName?: string;
  /** Variables de entorno a leer. Inyectable para poder probar sin tocar el proceso. */
  readonly environment?: NodeJS.ProcessEnv;
}

/** Operación a ejecutar dentro de un span. Recibe el span para añadir eventos o atributos. */
export type SpanOperation<T> = (span: Span) => Promise<T> | T;

export interface RunInSpanOptions {
  readonly attributes?: Attributes;
  /**
   * Abre una traza nueva en lugar de colgar del contexto activo. Necesario en tareas programadas,
   * que no tienen origen y no deben heredar el contexto de lo que se estuviera ejecutando.
   */
  readonly root?: boolean;
}
