import { Injectable } from '@nestjs/common';
import {
  type Attributes,
  type Context,
  SpanKind,
  context as otelContext,
  propagation,
} from '@opentelemetry/api';
import { TRACE_CARRIER_KEY } from './telemetry.constants';
import type { SpanOperation, TraceCarrier } from './telemetry.types';
import { TracingService } from './tracing.service';

/** Mensaje listo para persistir: el objeto de dominio más, si hay traza activa, el portador. */
export type TracedEnvelope = Record<string, unknown>;

/**
 * Propaga el contexto de traza entre procesos.
 *
 * En este motor el trabajo no viaja por un broker sino como **fila en PostgreSQL**: la API
 * escribe en el outbox o encola una ejecución, hace commit, y minutos después otro proceso la
 * reclama. El contexto de OpenTelemetry vive en el almacenamiento asíncrono del proceso y no
 * sobrevive a ese salto, así que la propagación tiene que ser explícita: se inyecta al publicar
 * y se extrae al consumir.
 */
@Injectable()
export class MessagingTraceService {
  constructor(private readonly tracing: TracingService) {}

  /**
   * Serializa el contexto activo en un portador de cabeceras W3C.
   *
   * @returns Mapa con `traceparent` y, cuando existan, `tracestate` y `baggage`. Vacío si no
   *   hay traza activa, que es un caso normal —telemetría apagada, trabajo interno— y no un error.
   */
  inject(): TraceCarrier {
    const carrier: TraceCarrier = {};
    propagation.inject(otelContext.active(), carrier);
    return carrier;
  }

  /**
   * Reconstruye el contexto remoto a partir del portador que viajó con el trabajo.
   *
   * Tolerante por diseño: una fila escrita antes de que existiera esta propagación no lleva
   * portador, y una manipulada puede llevar cualquier cosa. En ambos casos se devuelve el
   * contexto activo y el consumidor abre una traza raíz, en lugar de rechazar el trabajo.
   * **La compatibilidad hacia atrás es por construcción, no por una rama especial.**
   */
  extract(envelope: unknown): Context {
    const carrier = readCarrier(envelope);
    if (carrier === undefined) return otelContext.active();
    return propagation.extract(otelContext.active(), carrier);
  }

  /** Añade el portador a un mensaje sin tocar el objeto de dominio. */
  withCarrier(message: object): TracedEnvelope {
    const carrier = this.inject();
    const envelope: TracedEnvelope = { ...message };
    if (Object.keys(carrier).length > 0) envelope[TRACE_CARRIER_KEY] = carrier;
    return envelope;
  }

  /** Abre un span productor sobre la publicación de un trabajo. */
  runAsProducer<T>(name: string, attributes: Attributes, operation: SpanOperation<T>): Promise<T> {
    return this.tracing.runInSpanWith(name, { attributes, kind: SpanKind.PRODUCER }, operation);
  }

  /**
   * Abre un span consumidor enlazado al productor que originó el trabajo.
   *
   * Es `root: false` con contexto padre explícito: si el portador traía contexto, el span
   * continúa la traza del productor; si no, `extract` devolvió el contexto activo —vacío en un
   * worker— y se abre una traza nueva.
   */
  runAsConsumer<T>(
    name: string,
    carrier: unknown,
    attributes: Attributes,
    operation: SpanOperation<T>,
  ): Promise<T> {
    return this.tracing.runInSpanWith(
      name,
      { attributes, kind: SpanKind.CONSUMER, parentContext: this.extract(carrier) },
      operation,
    );
  }
}

/**
 * Extrae el portador, aceptando el mapa plano de cadenas directamente o envuelto bajo la clave
 * del sobre. Un valor con otra forma —anidado, numérico, nulo— se descarta sin error: perder la
 * correlación es preferible a perder el trabajo.
 */
function readCarrier(envelope: unknown): TraceCarrier | undefined {
  if (typeof envelope !== 'object' || envelope === null) return undefined;
  const record = envelope as Record<string, unknown>;
  const raw = TRACE_CARRIER_KEY in record ? record[TRACE_CARRIER_KEY] : record;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}
