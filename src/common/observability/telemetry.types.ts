import type { Attributes, Span } from '@opentelemetry/api';

/**
 * Portador del contexto de traza entre procesos. Mapa plano de cabeceras W3C
 * (`traceparent`, `tracestate`, `baggage`), que es exactamente lo que produce
 * `propagation.inject` y lo que se persiste junto al trabajo encolado.
 */
export type TraceCarrier = Record<string, string>;

/** Identificadores de la traza activa. Vacíos cuando no hay span en curso; nunca inventados. */
export interface ActiveTraceIds {
  readonly traceId: string | undefined;
  readonly spanId: string | undefined;
  readonly traceFlags: number | undefined;
}

/** Operación a ejecutar dentro de un span. Recibe el span para añadir eventos o atributos. */
export type SpanOperation<T> = (span: Span) => Promise<T> | T;

/**
 * Configuración efectiva del SDK, ya resuelta y validada.
 *
 * Se materializa como objeto en vez de leerse suelta desde `process.env` en cada punto de uso
 * para que exista **un** sitio donde comprobar qué se está exportando y a dónde.
 */
export interface TelemetryConfig {
  readonly enabled: boolean;
  readonly serviceName: string;
  readonly serviceNamespace: string;
  readonly serviceVersion: string;
  readonly deploymentEnvironment: string;
  /** `undefined` deja actuar al destino OTLP por defecto del exportador. */
  readonly tracesEndpoint: string | undefined;
  readonly exportTimeoutMs: number;
  readonly samplerRatio: number;
  /** Nombres de propagador ya normalizados, en el orden declarado. */
  readonly propagators: readonly string[];
  readonly diagLogLevel: string;
}

/** Atributos admitidos al abrir un span de negocio. Alias explícito por legibilidad. */
export type SpanAttributes = Attributes;
