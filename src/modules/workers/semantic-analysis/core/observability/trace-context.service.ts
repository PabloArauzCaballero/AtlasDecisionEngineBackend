import { Injectable } from '@nestjs/common';
import { isSpanContextValid, trace } from '@opentelemetry/api';
import type { ActiveTraceIds } from './telemetry.types';

const EMPTY: ActiveTraceIds = { traceId: undefined, spanId: undefined, traceFlags: undefined };

/**
 * Lee los identificadores de la traza en curso.
 *
 * Se expone también como funciones libres porque el logger de correlación se construye fuera del
 * contenedor de inyección de NestJS, antes de que exista aplicación.
 *
 * @returns Identificadores activos, o valores indefinidos cuando no hay span en curso.
 */
export function readActiveTraceIds(): ActiveTraceIds {
  const spanContext = trace.getActiveSpan()?.spanContext();
  // Un contexto inválido —todo ceros— significa «sin traza». Devolverlo como si fuera real haría
  // que los logs mostraran un identificador que no existe en Jaeger.
  if (spanContext === undefined || !isSpanContextValid(spanContext)) {
    return EMPTY;
  }
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    traceFlags: spanContext.traceFlags,
  };
}

/** Identificador de traza para entregar a soporte técnico, o `undefined` si no hay traza activa. */
export function readActiveTraceId(): string | undefined {
  return readActiveTraceIds().traceId;
}

@Injectable()
export class TraceContextService {
  public getActiveIds(): ActiveTraceIds {
    return readActiveTraceIds();
  }

  public getActiveTraceId(): string | undefined {
    return readActiveTraceIds().traceId;
  }

  public getActiveSpanId(): string | undefined {
    return readActiveTraceIds().spanId;
  }
}
