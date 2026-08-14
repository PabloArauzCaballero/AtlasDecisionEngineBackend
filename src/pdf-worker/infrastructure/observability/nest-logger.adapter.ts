/**
 * Registro estructurado y reloj del sistema.
 *
 * El adaptador delega en el `Logger` de Nest, que en este backend está enchufado a Pino: así el
 * worker aparece en el mismo flujo, con el mismo formato y la misma redacción de datos
 * personales que el resto del motor, sin importar nada de él.
 *
 * `redact` es la segunda barrera del §33. La primera es que ningún caso de uso pasa el payload
 * al registro; ésta recorta cualquier valor largo que se cuele por descuido, porque un log es
 * lo que más tiempo sobrevive de una petición y lo que más ojos ve.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { ClockPort, LogFields, LoggerPort } from '../../application/ports/runtime.ports';

const MAX_FIELD_CHARS = 400;

function redact(fields: LogFields | undefined): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (typeof value === 'string' && value.length > MAX_FIELD_CHARS) {
      safe[key] = `${value.slice(0, MAX_FIELD_CHARS)}…[${value.length}]`;
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

@Injectable()
export class NestLoggerAdapter implements LoggerPort {
  private readonly logger = new Logger('PdfWorker');

  debug(message: string, fields?: LogFields): void {
    this.logger.debug({ message, ...redact(fields) });
  }

  info(message: string, fields?: LogFields): void {
    this.logger.log({ message, ...redact(fields) });
  }

  warn(message: string, fields?: LogFields): void {
    this.logger.warn({ message, ...redact(fields) });
  }

  error(message: string, fields?: LogFields): void {
    this.logger.error({ message, ...redact(fields) });
  }
}

@Injectable()
export class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
}

/**
 * Reloj fijo, para pruebas y para la regresión visual del §46.
 *
 * Sin él, dos renders del mismo template producen PDF distintos —la fecha del pie cambia— y la
 * comparación de referencia no puede distinguir «cambió el diseño» de «pasó un segundo».
 */
export class FixedClock implements ClockPort {
  constructor(private readonly instant: Date) {}

  now(): Date {
    return new Date(this.instant.getTime());
  }
}
