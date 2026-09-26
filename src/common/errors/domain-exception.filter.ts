import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { trace } from '@opentelemetry/api';
import type { AccessDenialAuditorService } from '../security/access-denial-auditor.service';
import type { MetricsService } from '../observability/metrics.service';
import { TRACE_ID_HEADER } from '../observability/telemetry.constants';
import { readActiveTraceId } from '../observability/trace-context.service';
import { recordSpanError } from '../observability/trace-error';
import { DomainException } from './domain-exception';

/**
 * Aplana el `message` de una `HttpException` para el LOG.
 *
 * `ValidationPipe` lo entrega como un array de mensajes, y `String(['a','b'])` daba
 * `a,b` mientras que cualquier otro objeto daba `[object Object]`: justo en la línea que un
 * operador lee para saber qué se rechazó. La respuesta al cliente sigue llevando la forma
 * original en `error.details`; esto sólo afecta al texto del registro.
 */
function describe(message: unknown): string {
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.map((item) => describe(item)).join('; ');
  if (message === null || message === undefined) return '';
  return typeof message === 'object' ? JSON.stringify(message) : String(message);
}

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  constructor(
    private readonly config: ConfigService,
    /** Optional so the filter stays usable in contexts without a database. */
    private readonly denialAuditor?: AccessDenialAuditorService,
    /** Optional so the filter stays usable in contexts without the metrics registry. */
    private readonly metrics?: MetricsService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const requestId = String(
      request.principal?.requestId ?? request.headers['x-request-id'] ?? randomUUID(),
    );
    this.publishTraceId(response);

    // Se normaliza ANTES de decidir: así una violación de unicidad recorre exactamente el
    // mismo camino que cualquier otro rechazo de dominio —misma forma RFC7807, mismas
    // métricas, mismo registro— y aparece en el catálogo de errores generado del código.
    const normalized = this.asDomainException(exception) ?? exception;

    if (normalized instanceof DomainException) {
      const exception = normalized;
      this.metrics?.recordError(exception.code);
      this.markSpan(exception, exception.status, exception.code);
      this.logRejection(request, requestId, exception.status, exception.code, exception.message);
      this.auditDenial(request, requestId, exception.status, exception.code);
      response.status(exception.status).json({
        type: `https://atlas.local/errors/${exception.code.toLowerCase()}`,
        title: exception.code,
        status: exception.status,
        requestId,
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const bodyObject = typeof body === 'object' ? (body as Record<string, unknown>) : undefined;
      const message = typeof body === 'string' ? body : (bodyObject?.message ?? exception.message);
      this.metrics?.recordError(`HTTP_${status}`);
      this.markSpan(exception, status, `HTTP_${status}`);
      this.logRejection(request, requestId, status, `HTTP_${status}`, describe(message));
      this.auditDenial(request, requestId, status, `HTTP_${status}`);
      response.status(status).json({
        type: `https://atlas.local/errors/http-${status}`,
        title: `HTTP_${status}`,
        status,
        requestId,
        error: {
          code: `HTTP_${status}`,
          message,
          details: bodyObject,
        },
      });
      return;
    }

    const internalMessage = exception instanceof Error ? exception.message : String(exception);
    this.metrics?.recordError('INTERNAL_ERROR');
    this.markSpan(exception, HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR');
    this.logger.error(
      `Unhandled error for ${request.method} ${this.routeOf(request)}: ${internalMessage}`,
      exception instanceof Error ? exception.stack : undefined,
    );
    const production = this.config.get<string>('NODE_ENV') === 'production';
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      type: 'https://atlas.local/errors/internal-error',
      title: 'INTERNAL_ERROR',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      requestId,
      error: {
        code: 'INTERNAL_ERROR',
        message: production ? 'An unexpected server error occurred' : internalMessage,
      },
    });
  }

  /**
   * Traduce los fallos de infraestructura que SÍ tienen un significado de dominio.
   *
   * Una violación del índice único (P2002) es el llamante intentando crear algo que ya
   * existe: una petición que él puede corregir, no un fallo del servidor. Salía como
   * `INTERNAL_ERROR` 500, que ni se puede catalogar ni permite decidir si reintentar, y
   * además filtraba la consulta de Prisma y la ruta del archivo compilado en el mensaje.
   *
   * Los servicios que necesiten un código más preciso siguen capturándola antes; esto es
   * la red de seguridad para todo lo demás.
   */
  private asDomainException(exception: unknown): DomainException | undefined {
    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      return new DomainException(
        'RESOURCE_ALREADY_EXISTS',
        'Ya existe un registro con ese identificador único',
        HttpStatus.CONFLICT,
        // Sólo los nombres de columna, nunca los valores: el conflicto puede darse sobre un
        // dato del solicitante, y devolverlo confirmaría que ya está registrado.
        { target: exception.meta?.target },
      );
    }
    return undefined;
  }

  /**
   * Publica `x-trace-id` también en las respuestas de error.
   *
   * `TraceResponseInterceptor` no basta: los interceptores **no se ejecutan** cuando un guard
   * rechaza la petición, así que un 401 o un 403 salían sin cabecera — justo los casos en que
   * un usuario llama a soporte. Este filtro sí corre en todos ellos.
   *
   * Se detectó ejecutando `yarn jaeger:verify` contra el backend real, no razonando sobre el
   * código: la sonda recibió un 401 sin cabecera.
   */
  private publishTraceId(response: Response): void {
    const traceId = readActiveTraceId();
    if (traceId !== undefined && !response.headersSent) {
      response.setHeader(TRACE_ID_HEADER, traceId);
    }
  }

  /**
   * Marca el span activo con el fallo, sin crear ninguno.
   *
   * Sólo los 5xx marcan el span como error. Un 4xx es tráfico esperado —una validación, una
   * denegación de permiso, una regla de negocio— y marcarlo teñiría de rojo la mitad de las
   * trazas del panel, hasta que nadie mirara el color. Quedan registrados igualmente como
   * atributo, así que se pueden buscar.
   *
   * El span lo creó la instrumentación automática y **no se finaliza aquí**: cerrarlo dejaría
   * a la instrumentación intentando cerrar un span ya terminado y truncaría la duración justo
   * antes de escribir la respuesta.
   */
  private markSpan(exception: unknown, status: number, code: string): void {
    const span = trace.getActiveSpan();
    if (!span) return;
    if (status >= 500) {
      recordSpanError(span, exception, { code });
      return;
    }
    span.setAttribute('app.rejection.code', code);
  }

  /**
   * Fire-and-forget: the response must not wait on the audit write, and an audit failure
   * must never change the status the caller receives.
   */
  private auditDenial(request: Request, requestId: string, status: number, code: string): void {
    void this.denialAuditor?.record(request, requestId, status, code);
  }

  /**
   * Ruta sin query string.
   *
   * `originalUrl` lo incluye, y ahí viajan datos del solicitante: `?q=` de la búsqueda
   * global lleva el término tal cual escribió el usuario —un nombre, un identificador—, y el
   * `redact()` del logger sólo recorre objetos, no una línea de texto ya formada. La ruta es
   * lo que sirve para diagnosticar; los valores se reconstruyen desde el `requestId`, que va
   * en la misma línea y en la respuesta.
   */
  private routeOf(request: Request): string {
    const url = request.originalUrl ?? '';
    const queryStart = url.indexOf('?');
    return queryStart === -1 ? url : `${url.slice(0, queryStart)}?<redactado>`;
  }

  /** 4xx are expected traffic (auth/validation/business-rule denials) and logged at warn; 5xx at error. */
  private logRejection(
    request: Request,
    requestId: string,
    status: number,
    code: string,
    message: string,
  ): void {
    const line = `${request.method} ${this.routeOf(request)} rejected with ${status} ${code}: ${message}`;
    if (status >= 500) this.logger.error(line, undefined, requestId);
    else this.logger.warn(line, requestId);
  }
}
