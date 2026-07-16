import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RequestContextService } from '../context/request-context.service';
import { AccessLogInterceptor } from './access-log.interceptor';
import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsService } from './metrics.service';
import { RequestTimeoutInterceptor } from './request-timeout.interceptor';
import { StructuredLoggerService } from './structured-logger.service';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    RequestContextService,
    StructuredLoggerService,
    MetricsService,
    { provide: APP_INTERCEPTOR, useClass: RequestTimeoutInterceptor },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AccessLogInterceptor },
  ],
  exports: [RequestContextService, StructuredLoggerService, MetricsService],
})
export class ObservabilityModule {}
