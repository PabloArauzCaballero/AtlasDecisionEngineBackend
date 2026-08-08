import { Injectable } from '@nestjs/common';
import {
  type Attributes,
  type Context,
  type Span,
  type SpanKind,
  type SpanOptions,
  type Tracer,
  context as otelContext,
  trace,
} from '@opentelemetry/api';
import { TRACER_NAME } from './telemetry.constants';
import { recordSpanError } from './trace-error';
import type { SpanOperation } from './telemetry.types';

export interface RunInSpanConfiguration {
  readonly attributes?: Attributes;
  readonly kind?: SpanKind;
  /** Abre una traza nueva en lugar de colgar del contexto activo. */
  readonly root?: boolean;
  /** Contexto padre explícito, por ejemplo el extraído de un trabajo encolado. */
  readonly parentContext?: Context;
}

/**
 * Fachada de trazado para el código de negocio.
 *
 * Es la única dependencia que un servicio de dominio necesita para instrumentarse: no importa
 * ningún paquete de Jaeger ni construye spans a mano, de modo que cambiar de backend de trazas
 * —o retirarlas por completo— no toca la lógica de decisión.
 */
@Injectable()
export class TracingService {
  private readonly tracer: Tracer = trace.getTracer(TRACER_NAME);

  /**
   * Ejecuta una operación dentro de un span, que se finaliza **siempre**.
   *
   * Vale igual para operaciones síncronas y asíncronas: el resultado se espera antes de cerrar
   * el span, de modo que su duración refleja el trabajo real y no el tiempo hasta devolver la
   * promesa.
   *
   * @param name - Nombre estable `<dominio>.<acción>`, nunca construido con identificadores.
   * @param attributes - Atributos de baja cardinalidad y sin datos sensibles.
   * @param operation - Trabajo a ejecutar; recibe el span para añadir eventos o atributos.
   */
  runInSpan<T>(name: string, attributes: Attributes, operation: SpanOperation<T>): Promise<T> {
    return this.runInSpanWith(name, { attributes }, operation);
  }

  /**
   * Variante con control completo del span: tipo, raíz y contexto padre explícito.
   *
   * Ante una excepción la registra, marca el span como error y **relanza**. La observabilidad
   * no altera el flujo de control ni convierte un fallo en un éxito.
   */
  runInSpanWith<T>(
    name: string,
    configuration: RunInSpanConfiguration,
    operation: SpanOperation<T>,
  ): Promise<T> {
    const parent = configuration.parentContext ?? otelContext.active();
    return this.tracer.startActiveSpan(
      name,
      toSpanOptions(configuration),
      parent,
      async (span: Span): Promise<T> => {
        try {
          return await operation(span);
        } catch (error: unknown) {
          recordSpanError(span, error);
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  /**
   * Abre una traza nueva. Para trabajo que no se origina en ninguna solicitud —trabajos de
   * fondo, tareas programadas—, que no debe heredar el contexto de lo que se estuviera
   * ejecutando en el proceso.
   */
  runInRootSpan<T>(name: string, attributes: Attributes, operation: SpanOperation<T>): Promise<T> {
    return this.runInSpanWith(name, { attributes, root: true }, operation);
  }

  /** Span activo, o `undefined` fuera de todo contexto de traza. */
  getActiveSpan(): Span | undefined {
    return trace.getActiveSpan();
  }

  /** Añade un atributo al span activo. Sin span activo no hace nada. */
  setAttribute(key: string, value: Attributes[string]): void {
    trace.getActiveSpan()?.setAttribute(key, value ?? '');
  }

  setAttributes(attributes: Attributes): void {
    trace.getActiveSpan()?.setAttributes(attributes);
  }

  /** Registra un hito dentro de la operación en curso, sin abrir un span nuevo. */
  addEvent(name: string, attributes?: Attributes): void {
    trace.getActiveSpan()?.addEvent(name, attributes);
  }

  /**
   * Marca el span activo como fallido. Para errores que se gestionan sin propagarse, donde
   * `runInSpan` no puede verlos.
   */
  recordException(error: unknown): void {
    const span = trace.getActiveSpan();
    if (span !== undefined) recordSpanError(span, error);
  }
}

/** Las claves ausentes se omiten en vez de declararse `undefined`. */
function toSpanOptions(configuration: RunInSpanConfiguration): SpanOptions {
  return {
    ...(configuration.attributes === undefined ? {} : { attributes: configuration.attributes }),
    ...(configuration.kind === undefined ? {} : { kind: configuration.kind }),
    ...(configuration.root === undefined ? {} : { root: configuration.root }),
  };
}
