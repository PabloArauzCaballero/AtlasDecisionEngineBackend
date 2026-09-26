/** Installs one global telemetry stack so domains cannot silently omit observability. */
import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RequestContextService } from '../context/request-context.service';
import { AccessLogInterceptor } from './access-log.interceptor';
import { MessagingTraceService } from './messaging-trace.service';
import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsService } from './metrics.service';
import { RequestTimeoutInterceptor } from './request-timeout.interceptor';
import { StructuredLoggerService } from './structured-logger.service';
import { TraceContextService } from './trace-context.service';
import { TraceResponseInterceptor } from './trace-response.interceptor';
import { TracingService } from './tracing.service';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    RequestContextService,
    StructuredLoggerService,
    MetricsService,
    // La capa de trazado es global por la misma razón que el logger: un dominio no debería
    // tener que importar un módulo para poder instrumentarse, porque el que no lo importa es
    // justamente el que se queda sin observabilidad.
    TracingService,
    TraceContextService,
    MessagingTraceService,
    { provide: APP_INTERCEPTOR, useClass: RequestTimeoutInterceptor },
    // Antes que el resto: fija `x-trace-id` mientras las cabeceras siguen siendo escribibles.
    { provide: APP_INTERCEPTOR, useClass: TraceResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AccessLogInterceptor },
  ],
  exports: [
    RequestContextService,
    StructuredLoggerService,
    MetricsService,
    TracingService,
    TraceContextService,
    MessagingTraceService,
  ],
})
export class ObservabilityModule {}
