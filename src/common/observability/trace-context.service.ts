import { Injectable } from '@nestjs/common';
import { isSpanContextValid, trace } from '@opentelemetry/api';
import type { ActiveTraceIds } from './telemetry.types';

const EMPTY: ActiveTraceIds = { traceId: undefined, spanId: undefined, traceFlags: undefined };

/**
 * Lee los identificadores de la traza en curso.
 *
 * Se expone también como función libre porque el logger estructurado la usa en cada línea y no
 * conviene atarlo al contenedor de inyección para algo que es una lectura sin estado.
 *
 * @returns Identificadores activos, o valores indefinidos cuando no hay span en curso.
 */
export function readActiveTraceIds(): ActiveTraceIds {
  const spanContext = trace.getActiveSpan()?.spanContext();
  // Un contexto inválido —todo ceros— significa «sin traza». Devolverlo como si fuera real
  // haría que los logs mostraran un identificador que no existe en Jaeger, que es peor que no
  // mostrar ninguno: manda a soporte a buscar algo que nunca estuvo.
  if (spanContext === undefined || !isSpanContextValid(spanContext)) return EMPTY;
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
  };
}

/** Identificador de traza para entregar a soporte técnico, o `undefined` si no hay traza. */
export function readActiveTraceId(): string | undefined {
  return readActiveTraceIds().traceId;
}

@Injectable()
export class TraceContextService {
  getActiveIds(): ActiveTraceIds {
    return readActiveTraceIds();
  }

  getActiveTraceId(): string | undefined {
    return readActiveTraceIds().traceId;
  }

  getActiveSpanId(): string | undefined {
    return readActiveTraceIds().spanId;
  }
}
