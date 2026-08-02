/**
 * Arranque del proceso de trabajos de fondo.
 *
 * Es el hermano de `main.ts`: carga EXACTAMENTE el mismo `AppModule` —misma configuración
 * validada, mismo Prisma, mismo logger, mismas métricas— pero como contexto de aplicación,
 * sin adaptador HTTP y por tanto sin controladores de negocio. Esa es la garantía que
 * importa: un proceso WORKER no puede atender una decisión aunque alguien le enrute
 * tráfico, y no hay una segunda definición de la configuración que se desvíe de la de la API.
 *
 * Qué corre aquí lo decide `WORKER_ROLE` (ver common/config/worker-role.ts), no este
 * fichero: los servicios de fondo consultan el rol en su propio `onModuleInit`. Ejecutar
 * este arranque con `WORKER_ROLE=API` produce un proceso que no hace nada, así que se
 * rechaza al arrancar en vez de quedarse vivo y en silencio.
 *
 * Sondas: el orquestador necesita saber si reiniciar este proceso, y un contenedor sin
 * puerto no se puede sondear. Se levanta un servidor mínimo de `node:http` —sin Express,
 * sin rutas de negocio— que delega en el MISMO `HealthProbeService` que usa la API, para
 * que «listo» signifique lo mismo en los dos procesos.
 *
 * Ese mismo servidor expone `/metrics`. La alternativa era no exponerlas, y eso dejaba
 * ciego justo al proceso que hace el trabajo: `atlas_job_*`, `atlas_outbox_*` y
 * `atlas_notification_created_total` solo se producen aquí, así que sin este endpoint el
 * panel del outbox se alimentaba de réplicas de API que ya no reparten nada. Va protegido
 * por el MISMO `METRICS_TOKEN` que el endpoint de la API, comparado en tiempo constante.
 */
import 'reflect-metadata';
// Igual que en main.ts: las instrumentaciones parchean http/pg/ioredis al requerirse, así
// que arrancar la traza después de cargar Nest no produciría ningún span.
import { startTracing, stopTracing } from './common/observability/tracing';

startTracing();

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AppModule } from './app.module';
import { StructuredLoggerService } from './common/observability/structured-logger.service';
import { MetricsService } from './common/observability/metrics.service';
import { HashService } from './common/crypto/hash.service';
import { JobSchedulerService } from './common/jobs/job-scheduler.service';
import { workerRoleOf } from './common/config/worker-role';
import { HealthProbeService } from './modules/health/health-probe.service';

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON() {
  return this.toString();
};

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function sendText(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void {
  response.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

/** Cabecera única, aunque el cliente mande varias: dos valores no son una credencial. */
function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? undefined : value;
}

async function bootstrapWorker(): Promise<void> {
  const context = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  const logger = context.get(StructuredLoggerService);
  context.useLogger(logger);

  const config = context.get(ConfigService);
  const role = workerRoleOf(config);
  if (role === 'API') {
    // Un worker con rol API no arrancaría ni un solo trabajo: sería un contenedor vivo,
    // verde ante el orquestador y sin procesar nada. Fallar aquí convierte un error de
    // configuración silencioso en un arranque fallido visible.
    throw new Error(
      'WORKER_ROLE=API en el proceso worker: no ejecutaría ningún trabajo de fondo. Use WORKER o ALL.',
    );
  }

  const probe = context.get(HealthProbeService);
  const metrics = context.get(MetricsService);
  const hashes = context.get(HashService);
  const scheduler = context.get(JobSchedulerService);
  const metricsEnabled = config.get<boolean>('METRICS_ENABLED') ?? true;
  const metricsToken = config.get<string>('METRICS_TOKEN') ?? '';

  const port = config.get<number>('WORKER_HEALTH_PORT') ?? 3001;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const path = (request.url ?? '/').split('?')[0];
    if (request.method !== 'GET') return send(response, 405, { error: 'method_not_allowed' });
    if (path === '/health' || path === '/health/live') return send(response, 200, probe.live());
    if (path === '/health/ready' || path === '/ready') {
      void probe
        .ready()
        .then((report) =>
          send(response, report.ready ? 200 : 503, {
            status: report.ready ? 'ready' : 'not_ready',
            checks: report.checks,
            timestamp: report.timestamp,
          }),
        )
        .catch(() => send(response, 503, { status: 'not_ready' }));
      return;
    }
    if (path === '/metrics') {
      if (!metricsEnabled) return send(response, 404, { error: 'metrics_disabled' });
      const supplied = singleHeader(request.headers['x-metrics-token']);
      // Se comparan los digest y no las cadenas: `timingSafeEqual` exige la misma longitud,
      // y comparar longitudes de secretos ya filtra información.
      if (
        metricsToken &&
        (!supplied || !hashes.equals(hashes.sha256(supplied), hashes.sha256(metricsToken)))
      ) {
        return send(response, 401, { error: 'unauthorized' });
      }
      void metrics
        .renderPrometheus()
        .then((body) => sendText(response, 200, 'text/plain; version=0.0.4; charset=utf-8', body))
        .catch(() => send(response, 500, { error: 'metrics_unavailable' }));
      return;
    }
    send(response, 404, { error: 'not_found' });
  });
  await new Promise<void>((resolve) => server.listen(port, '0.0.0.0', resolve));

  // Nest cierra el contexto —y con él los onModuleDestroy que drenan los trabajos en
  // vuelo— pero nadie cerraría el servidor de sondas ni vaciaría las trazas.
  context.enableShutdownHooks();
  let shuttingDown = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      server.close();
      void context
        .close()
        .then(() => stopTracing())
        .then(() => process.exit(0));
    });
  }

  Logger.log(
    {
      message: 'ATLAS Decision Engine worker started',
      role,
      healthPort: port,
      // Deja constancia de QUÉ trabajos quedaron activos en este arranque: un interruptor
      // apagado por error produce un contenedor verde que no procesa nada, y esta línea es
      // lo primero que se mira cuando la cola no baja.
      jobs: scheduler.registeredJobs(),
      metrics: metricsEnabled ? `http://0.0.0.0:${port}/metrics` : 'disabled',
      version: config.get<string>('BUILD_VERSION'),
      commit: config.get<string>('COMMIT_SHA'),
    },
    'WorkerBootstrap',
  );
}

void bootstrapWorker().catch((error: unknown) => {
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
