import { Injectable } from '@nestjs/common';
import {
  type Attributes,
  type Context,
  SpanKind,
  context as otelContext,
  propagation,
} from '@opentelemetry/api';
import { TracingService } from './tracing.service';
import { TRACE_CARRIER_KEY } from './telemetry.constants';
import type { SpanOperation, TraceCarrier } from './telemetry.types';

/**
 * Mensaje listo para la cola: el objeto de dominio más, si hay traza activa, el sobre de contexto.
 * Se tipa como mapa abierto porque eso es exactamente lo que se serializa en la base de datos.
 */
export type TracedEnvelope = Record<string, unknown>;

/**
 * Propaga el contexto de traza a través de la cola.
 *
 * El contexto de OpenTelemetry vive en el almacenamiento asíncrono del proceso y no sobrevive a que
 * un mensaje se persista en PostgreSQL y lo recoja otro proceso minutos después. La propagación
 * tiene que ser explícita: se inyecta al publicar y se extrae al consumir.
 */
@Injectable()
export class MessagingTraceService {
  public constructor(private readonly tracing: TracingService) {}

  /**
   * Serializa el contexto activo en un portador de cabeceras W3C.
   *
   * @returns Mapa con `traceparent` y, cuando existan, `tracestate` y `baggage`. Vacío si no hay
   *   traza activa, lo que es un caso normal y no un error.
   */
  public inject(): TraceCarrier {
    const carrier: TraceCarrier = {};
    propagation.inject(otelContext.active(), carrier);
    return carrier;
  }

  /**
   * Reconstruye el contexto remoto a partir del sobre que viajó con el mensaje.
   *
   * Tolerante por diseño: un mensaje encolado antes de que existiera esta propagación no lleva
   * sobre, y uno manipulado puede llevar cualquier cosa. En ambos casos se devuelve el contexto
   * activo y el consumidor abre una traza raíz, en lugar de rechazar el trabajo.
   *
   * @param envelope - Datos del job tal como los entrega la cola, sin validar.
   */
  public extract(envelope: unknown): Context {
    const carrier = readCarrier(envelope);
    if (carrier === undefined) {
      return otelContext.active();
    }
    return propagation.extract(otelContext.active(), carrier);
  }

  /**
   * Añade el sobre de traza a un mensaje sin tocar el objeto de dominio.
   *
   * El portador viaja como propiedad hermana porque el esquema de la solicitud descarta las claves
   * desconocidas en silencio: dentro del objeto, el `traceparent` se perdería sin ningún aviso.
   */
  public withCarrier(message: object): TracedEnvelope {
    const carrier = this.inject();
    const envelope: TracedEnvelope = { ...message };
    if (Object.keys(carrier).length > 0) {
      envelope[TRACE_CARRIER_KEY] = carrier;
    }
    return envelope;
  }

  /** Abre un span productor sobre la publicación de un mensaje. */
  public runAsProducer<T>(
    name: string,
    attributes: Attributes,
    operation: SpanOperation<T>,
  ): Promise<T> {
    return this.tracing.runInSpanWith(name, { attributes, kind: SpanKind.PRODUCER }, operation);
  }

  /**
   * Abre un span consumidor enlazado al productor que originó el mensaje.
   *
   * Es `root: false` con contexto padre explícito: si el sobre traía contexto, el span continúa la
   * traza del productor; si no, `extract` devolvió el contexto activo —vacío en un worker— y se
   * abre una traza nueva.
   */
  public runAsConsumer<T>(
    name: string,
    envelope: unknown,
    attributes: Attributes,
    operation: SpanOperation<T>,
  ): Promise<T> {
    return this.tracing.runInSpanWith(
      name,
      { attributes, kind: SpanKind.CONSUMER, parentContext: this.extract(envelope) },
      operation,
    );
  }
}

/**
 * Extrae el portador del sobre, aceptando únicamente un mapa plano de cadenas.
 *
 * Un valor con otra forma —anidado, numérico, nulo— se descarta sin error: el mensaje sigue siendo
 * procesable y perder la correlación es preferible a perder el trabajo.
 */
function readCarrier(envelope: unknown): TraceCarrier | undefined {
  if (typeof envelope !== 'object' || envelope === null) {
    return undefined;
  }
  const raw = (envelope as Record<string, unknown>)[TRACE_CARRIER_KEY];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const entries = Object.entries(raw).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}
