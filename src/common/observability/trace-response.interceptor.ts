import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { TRACE_ID_HEADER } from './telemetry.constants';
import { readActiveTraceId } from './trace-context.service';

/**
 * Publica el identificador de la traza en la respuesta.
 *
 * Es el puente entre un usuario que reporta un fallo y la traza que lo explica: soporte técnico
 * pide el `x-trace-id` y lo busca en Jaeger, sin depender de que el incidente se pueda
 * reproducir.
 *
 * El identificador procede **siempre** del contexto activo de OpenTelemetry, nunca de una
 * cabecera del cliente: un valor aportado por el llamante sería trivial de falsificar y no
 * correspondería a ninguna traza real. Cuando no hay traza —telemetría apagada o ruta
 * excluida— la cabecera simplemente no se emite; una vacía o inventada sería peor, porque
 * mandaría a buscar algo que no existe.
 *
 * El cuerpo JSON **no se toca**: el contrato de respuesta no cambia por añadir trazabilidad.
 * La correlación de negocio sigue siendo `requestId`, que ya viaja en cada error.
 */
@Injectable()
export class TraceResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // La cabecera se fija ANTES de ejecutar el manejador: después, la respuesta puede haberse
    // enviado ya —un stream SSE, una descarga— y escribir cabeceras sobre ella lanzaría.
    if (context.getType() === 'http') {
      const traceId = readActiveTraceId();
      const response = context.switchToHttp().getResponse<Response>();
      if (traceId !== undefined && !response.headersSent) {
        response.setHeader(TRACE_ID_HEADER, traceId);
      }
    }
    return next.handle();
  }
}
