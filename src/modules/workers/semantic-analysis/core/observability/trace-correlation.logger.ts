import { ConsoleLogger, type LogLevel, type LoggerService } from '@nestjs/common';
import { readActiveTraceIds } from './trace-context.service';

export interface TraceCorrelationLoggerOptions {
  /** JSON estructurado para producción; formato legible de NestJS para desarrollo. */
  readonly json: boolean;
}

interface StructuredRecord {
  readonly level: LogLevel;
  readonly time: string;
  readonly context: string | undefined;
  readonly message: string;
  readonly trace_id?: string;
  readonly span_id?: string;
  readonly trace_flags?: number;
  readonly stack?: string;
}

/**
 * Logger que añade a cada registro los identificadores de la traza en curso.
 *
 * Envuelve al `Logger` de NestJS en lugar de sustituirlo: al instalarse con `app.useLogger(...)`,
 * todos los `new Logger(...)` que ya existen en el worker pasan por aquí y quedan correlacionados
 * sin tocar una sola línea de la lógica de negocio. **No duplica** ningún registro: es el mismo, con
 * más campos.
 *
 * El `trace_id` procede siempre del contexto activo de OpenTelemetry. Nunca de un encabezado ni de
 * un identificador aportado por el cliente, que sería trivial de falsificar y no correspondería a
 * ninguna traza real en el backend.
 */
export class TraceCorrelationLogger implements LoggerService {
  private readonly delegate = new ConsoleLogger();

  public constructor(private readonly options: TraceCorrelationLoggerOptions) {}

  public log(message: unknown, ...rest: unknown[]): void {
    this.emit('log', message, rest);
  }

  public error(message: unknown, ...rest: unknown[]): void {
    this.emit('error', message, rest);
  }

  public warn(message: unknown, ...rest: unknown[]): void {
    this.emit('warn', message, rest);
  }

  public debug(message: unknown, ...rest: unknown[]): void {
    this.emit('debug', message, rest);
  }

  public verbose(message: unknown, ...rest: unknown[]): void {
    this.emit('verbose', message, rest);
  }

  public fatal(message: unknown, ...rest: unknown[]): void {
    this.emit('fatal', message, rest);
  }

  public setLogLevels(levels: LogLevel[]): void {
    this.delegate.setLogLevels(levels);
  }

  private emit(level: LogLevel, message: unknown, rest: readonly unknown[]): void {
    if (this.options.json) {
      writeStructured(this.buildRecord(level, message, rest));
      return;
    }
    this.writeReadable(level, message, rest);
  }

  /**
   * En desarrollo se conserva el formato coloreado de NestJS y los identificadores se anexan como
   * sufijo: buscar por `trace_id` en la terminal sigue funcionando y la salida sigue siendo legible.
   */
  private writeReadable(level: LogLevel, message: unknown, rest: readonly unknown[]): void {
    const { traceId, spanId } = readActiveTraceIds();
    const suffix = traceId === undefined ? '' : ` trace_id=${traceId} span_id=${spanId ?? '-'}`;
    const decorated = `${stringify(message)}${suffix}`;
    switch (level) {
      case 'error':
        this.delegate.error(decorated, ...rest);
        return;
      case 'warn':
        this.delegate.warn(decorated, ...rest);
        return;
      case 'debug':
        this.delegate.debug(decorated, ...rest);
        return;
      case 'verbose':
        this.delegate.verbose(decorated, ...rest);
        return;
      case 'fatal':
        this.delegate.fatal(decorated, ...rest);
        return;
      default:
        this.delegate.log(decorated, ...rest);
    }
  }

  private buildRecord(
    level: LogLevel,
    message: unknown,
    rest: readonly unknown[],
  ): StructuredRecord {
    const { traceId, spanId, traceFlags } = readActiveTraceIds();
    const { context, stack } = splitRest(rest);
    return {
      level,
      time: new Date().toISOString(),
      context,
      message: stringify(message),
      // Sin span activo los campos se omiten. Un `trace_id` vacío o inventado sería peor que su
      // ausencia: haría creer que la traza existe y no aparece en Jaeger.
      ...(traceId === undefined ? {} : { trace_id: traceId }),
      ...(spanId === undefined ? {} : { span_id: spanId }),
      ...(traceFlags === undefined ? {} : { trace_flags: traceFlags }),
      ...(stack === undefined ? {} : { stack }),
    };
  }
}

/**
 * Construye el logger según el entorno.
 *
 * @param environment - Variables del proceso. `LOG_FORMAT` tiene prioridad sobre `NODE_ENV` para
 *   poder forzar JSON en desarrollo al depurar la correlación.
 */
export function createTraceCorrelationLogger(
  environment: NodeJS.ProcessEnv = process.env,
): TraceCorrelationLogger {
  const format = environment['LOG_FORMAT'];
  const json = format === undefined ? environment['NODE_ENV'] === 'production' : format === 'json';
  return new TraceCorrelationLogger({ json });
}

/**
 * NestJS pasa el contexto como último argumento y, en `error`, la pila como primero. Se separan sin
 * asumir la forma exacta: un argumento inesperado no debe romper el registro.
 */
function splitRest(rest: readonly unknown[]): {
  context: string | undefined;
  stack: string | undefined;
} {
  const strings = rest.filter((value): value is string => typeof value === 'string');
  const context = strings.length > 0 ? strings[strings.length - 1] : undefined;
  const stack = strings.length > 1 ? strings[0] : undefined;
  return { context, stack };
}

function stringify(message: unknown): string {
  if (typeof message === 'string') {
    return message;
  }
  if (message instanceof Error) {
    return message.message;
  }
  try {
    return JSON.stringify(message) ?? String(message);
  } catch {
    return String(message);
  }
}

/**
 * Escribe una línea JSON por registro.
 *
 * Se usa `process.stdout.write` porque es el transporte de logs del proceso —el mismo que ya emplean
 * los scripts autónomos del paquete—, no una traza de depuración: no hay `console.log` en ninguna
 * ruta de observabilidad.
 */
function writeStructured(record: StructuredRecord): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}
