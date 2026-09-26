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

// Nombre propio, distinto del de la API: es el que separa los dos procesos en Jaeger.
startTracing('atlas-worker');

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AppModule } from './app.module';
import { StructuredLoggerService } from './common/observability/structured-logger.service';
import {
  extractMetricsToken,
  isAuthorizedMetricsRequest,
} from './common/observability/metrics-token';
import { MetricsService } from './common/observability/metrics.service';
import { HashService } from './common/crypto/hash.service';
import { JobSchedulerService } from './common/jobs/job-scheduler.service';
import { workerRoleOf } from './common/config/worker-role';
import { DataSourceHealthService } from './common/persistence/health/data-source-health.service';
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

/**
 * Contexto ya creado, para que el manejador de fallo de arranque pueda cerrarlo.
 *
 * Sin esto, un arranque que falla DESPUÉS de crear el contexto —el rechazo de `WORKER_ROLE`
 * de más abajo es exactamente ese caso— dejaba el pool de Postgres y la escucha de trabajos
 * abiertos: `process.exitCode = 1` no termina un proceso que aún tiene descriptores vivos,
 * así que el contenedor tardaba en morir lo que tardase el pool en cerrar por inactividad
 * (`DATABASE_IDLE_TIMEOUT_MS`, 30 s por defecto) — medido: 30,1 s entre el log fatal y la
 * salida real. Un fallo de configuración que se anuncia rápido pero sale despacio alarga
 * cada vuelta del ciclo de reinicio y pierde las trazas del propio fallo.
 */
let startedContext: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;

async function bootstrapWorker(): Promise<void> {
  const context = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  startedContext = context;
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
  const dataSources = context.get(DataSourceHealthService);
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
    // Misma sonda de fuentes de datos que la API, por la misma razón que `/health/ready`:
    // el worker abre sus propias conexiones y, durante un incidente, hay que poder ver las
    // suyas y no las de otro proceso. Responde 200 aunque estén degradadas — el veredicto
    // de sacarlo de rotación lo da `/health/ready`, y un 503 aquí escondería el cuerpo que
    // se viene a leer.
    if (path === '/health/data-sources') {
      void dataSources
        .report()
        .then((report) => send(response, 200, report))
        .catch(() => send(response, 503, { status: 'unknown' }));
      return;
    }
    if (path === '/metrics') {
      if (!metricsEnabled) return send(response, 404, { error: 'metrics_disabled' });
      // Misma decisión que en el endpoint de la API, y por el mismo código: `/metrics` del
      // worker y el de la API tienen que autorizar igual, o el panel del outbox se alimenta
      // de un proceso y no del otro.
      const supplied = extractMetricsToken(request.headers);
      if (
        !isAuthorizedMetricsRequest(
          supplied,
          metricsToken,
          (a, b) => hashes.equals(a, b),
          (value) => hashes.sha256(value),
        )
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
  const graceMs = config.get<number>('SHUTDOWN_GRACE_MS') ?? 20_000;
  let shuttingDown = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      server.close();
      // Plazo duro para TODO el apagado. El orquestador ya lleva su propio cronómetro
      // (`terminationGracePeriodSeconds`) y al agotarlo manda SIGKILL, que no deja escribir
      // ni una línea. Salir por decisión propia un momento antes conserva el motivo en el
      // log; llegar al SIGKILL lo pierde. `unref` para que este temporizador no sea nunca
      // la causa de que el proceso siga vivo cuando ya no queda nada que cerrar.
      const watchdog = setTimeout(() => {
        process.stderr.write(
          `${JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            context: 'WorkerShutdown',
            message: `El apagado ordenado no terminó en ${graceMs} ms; se fuerza la salida`,
          })}\n`,
        );
        process.exit(1);
      }, graceMs);
      watchdog.unref?.();

      void context
        .close()
        .then(() => stopTracing())
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
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

void bootstrapWorker().catch(async (error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'fatal',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })}\n`,
  );
  // Cerrar lo que sí llegó a abrirse antes de salir: el pool de Postgres, la escucha de
  // trabajos y el exportador de trazas. Es best-effort —ya estamos en el camino de fallo, y
  // un error aquí no puede tapar el que nos trajo— pero sin ello la salida depende de que
  // cada descriptor caiga por su propio timeout de inactividad. `exit(1)` explícito y no
  // `exitCode`: el cierre puede dejar algo vivo y la salida no puede quedar a su merced.
  await startedContext?.close().catch(() => undefined);
  await stopTracing().catch(() => undefined);
  process.exit(1);
});
