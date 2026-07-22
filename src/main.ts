import 'reflect-metadata';
// Must precede every other import: the OpenTelemetry instrumentations patch http/express/pg/
// ioredis as those modules are required, so starting after Nest has loaded them yields no spans.
import { startTracing, stopTracing } from './common/observability/tracing';

startTracing();

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { json, type NextFunction, type Request, type Response, urlencoded } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { RequestContextService } from './common/context/request-context.service';
import { DomainExceptionFilter } from './common/errors/domain-exception.filter';
import { AccessDenialAuditorService } from './common/security/access-denial-auditor.service';
import { StructuredLoggerService } from './common/observability/structured-logger.service';
import { MetricsService } from './common/observability/metrics.service';

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON() {
  return this.toString();
};

function requestIdFrom(request: Request): string {
  const supplied = request.headers['x-request-id'];
  const value = Array.isArray(supplied) ? supplied[0] : supplied;
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{8,120}$/.test(value) ? value : randomUUID();
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
    forceCloseConnections: true,
  });
  const config = app.get(ConfigService);
  const logger = app.get(StructuredLoggerService);
  const requestContext = app.get(RequestContextService);
  app.useLogger(logger);

  const expressApp = app.getHttpAdapter().getInstance() as {
    set: (name: string, value: unknown) => void;
  };
  expressApp.set('trust proxy', config.get<number>('TRUST_PROXY_HOPS') ?? 1);
  const bodyLimit = config.get<number>('BODY_LIMIT_BYTES') ?? 1_048_576;
  app.use(json({ limit: bodyLimit, strict: true }));
  app.use(urlencoded({ extended: false, limit: bodyLimit }));
  app.use((request: Request, response: Response, next: NextFunction) => {
    const requestId = requestIdFrom(request);
    request.headers['x-request-id'] = requestId;
    response.setHeader('x-request-id', requestId);
    response.setHeader('cache-control', 'no-store');
    requestContext.run({ requestId, startedAt: performance.now() }, next);
  });

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(compression({ threshold: 1_024 }));

  const allowedOrigins = (config.get<string>('CORS_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins.length
      ? (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) =>
          callback(null, !origin || allowedOrigins.includes(origin))
      : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    // x-principal-id and x-roles are deliberately absent: identity and roles resolve
    // from the integration client registry, never from caller-supplied headers.
    allowedHeaders: [
      'authorization',
      'content-type',
      'if-match',
      'x-api-key',
      'x-tenant-id',
      'x-request-id',
    ],
    exposedHeaders: [
      'x-request-id',
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
      'retry-after',
      'etag',
    ],
    credentials: true,
    maxAge: 600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(config, app.get(AccessDenialAuditorService), app.get(MetricsService)),
  );
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  // The OpenTelemetry SDK is started before Nest and lives outside its lifecycle, so
  // enableShutdownHooks never flushes it. Without this, whatever spans are still buffered
  // when the process is asked to stop are dropped — exactly the shutdown window where a
  // failing request is most interesting. Nest closes the app on these signals but does not
  // force an exit, so the process stays alive until this flush resolves.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void stopTracing();
    });
  }

  if (config.get<boolean>('SWAGGER_ENABLED') ?? false) {
    // The document is versioned by the API CONTRACT (API_VERSION), not by the build: a consumer
    // pins to `v1` and must only be forced to change when the contract breaks, whereas
    // BUILD_VERSION moves every release. The build is still published, as metadata, so a
    // returned spec can be traced back to the exact artifact that served it.
    const apiVersion = config.get<string>('API_VERSION') ?? 'v1';
    const buildVersion = config.get<string>('BUILD_VERSION') ?? '2.0.0';
    const swaggerConfig = new DocumentBuilder()
      .setTitle('ATLAS Decision Platform API')
      .setDescription(
        `Governed credit, risk and fraud decision platform.\n\n` +
          `Contract version **${apiVersion}** — served by build ${buildVersion} ` +
          `(commit ${config.get<string>('COMMIT_SHA') ?? 'local'}).`,
      )
      .setVersion(apiVersion)
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
      .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'api-key')
      .addApiKey({ type: 'apiKey', in: 'header', name: 'x-tenant-id' }, 'tenant')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    document.security = [{ bearer: [] }, { 'api-key': [], tenant: [] }];
    for (const publicPath of ['/health', '/health/live', '/health/ready', '/ready']) {
      const pathItem = document.paths[publicPath];
      if (!pathItem) continue;
      for (const operation of Object.values(pathItem)) {
        if (operation && typeof operation === 'object' && 'responses' in operation)
          operation.security = [];
      }
    }
    // Served at a version-pinned path so a consumer can fetch the contract it was built
    // against. `docs/openapi.json` stays as the unversioned alias for existing tooling.
    SwaggerModule.setup(`docs/${apiVersion}`, app, document, {
      jsonDocumentUrl: `docs/${apiVersion}/openapi.json`,
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
    });
    SwaggerModule.setup('docs', app, document, {
      jsonDocumentUrl: 'docs/openapi.json',
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
    });
  }

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port, '0.0.0.0');
  Logger.log(
    {
      message: 'ATLAS Decision Engine started',
      port,
      version: config.get<string>('BUILD_VERSION'),
      commit: config.get<string>('COMMIT_SHA'),
      authMode: config.get<string>('AUTH_MODE'),
    },
    'Bootstrap',
  );
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'fatal',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })}\n`,
  );
  process.exitCode = 1;
});
