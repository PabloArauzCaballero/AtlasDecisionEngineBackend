import { ConfigService } from '@nestjs/config';
import { HealthProbeService } from '../src/modules/health/health-probe.service';
import type { CacheService } from '../src/common/cache/cache.service';
import type { JobSchedulerService } from '../src/common/jobs/job-scheduler.service';
import type { JobSignalService } from '../src/common/jobs/job-signal.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';

/**
 * Las sondas de salud deciden si el orquestador reinicia el proceso o lo saca de rotación,
 * así que sus dos invariantes no son cosméticos:
 *
 *  1. `ready()` **nunca lanza**. Una excepción se convertiría en un 500 sin cuerpo, y el
 *     operador perdería precisamente la lista de qué comprobación falló.
 *  2. La respuesta **no revela topología**. `/health/ready` es público: el texto crudo del
 *     driver lleva host, puerto y versión, y eso es reconocimiento gratis.
 *
 * Se prueban contra dobles porque lo que se verifica es el CONTRATO de la sonda ante una
 * dependencia caída, no que Postgres responda.
 */
describe('HealthProbeService', () => {
  const config = (extra: Record<string, unknown> = {}) =>
    new ConfigService({ BUILD_VERSION: '2.0.0', COMMIT_SHA: 'abc123', ...extra });

  const scheduler = {
    registeredJobs: () => ['outbox-relay', 'test-run'],
  } as unknown as JobSchedulerService;
  const jobSignal = { enabled: true, connected: true } as unknown as JobSignalService;

  const prismaOk = {
    $queryRaw: () => Promise.resolve([{ '?column?': 1 }]),
  } as unknown as PrismaService;
  const cacheOk = { ping: () => Promise.resolve('redis' as const) } as unknown as CacheService;

  describe('live()', () => {
    it('informa del rol del proceso, para distinguir una réplica de API de un worker', () => {
      const probe = new HealthProbeService(
        prismaOk,
        cacheOk,
        config({ WORKER_ROLE: 'WORKER' }),
        scheduler,
        jobSignal,
      );
      const report = probe.live();
      expect(report.status).toBe('ok');
      expect(report.role).toBe('WORKER');
      expect(report.version).toBe('2.0.0');
      expect(report.commit).toBe('abc123');
      expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it('un WORKER_ROLE que no existe cae a ALL en vez de propagar basura', () => {
      // `workerRoleOf` normaliza contra la lista cerrada. Que la sonda publique un rol
      // inventado sería peor que inútil: el panel agruparía procesos por un valor que no
      // corresponde a ningún reparto real.
      const probe = new HealthProbeService(
        prismaOk,
        cacheOk,
        config({ WORKER_ROLE: 'NO_EXISTE' }),
        scheduler,
        jobSignal,
      );
      expect(probe.live().role).toBe('ALL');
    });

    it('la marca de tiempo es ISO 8601, que es lo que consumen las sondas', () => {
      const probe = new HealthProbeService(prismaOk, cacheOk, config(), scheduler, jobSignal);
      const { timestamp } = probe.live();
      expect(new Date(timestamp).toISOString()).toBe(timestamp);
    });
  });

  describe('ready()', () => {
    it('está listo cuando base de datos y caché responden', async () => {
      const probe = new HealthProbeService(
        prismaOk,
        cacheOk,
        config({ WORKER_ROLE: 'API' }),
        scheduler,
        jobSignal,
      );
      const report = await probe.ready();
      expect(report.ready).toBe(true);
      expect(report.checks.database).toBe('ok');
      expect(report.checks.cache).toBe('redis');
      // WORKER_ROLE=API no corre trabajos de fondo: no debe informar de ellos.
      expect(report.checks.jobs).toBeUndefined();
    });

    it('informa de los trabajos de fondo sólo donde de verdad corren', async () => {
      const probe = new HealthProbeService(
        prismaOk,
        cacheOk,
        config({ WORKER_ROLE: 'WORKER' }),
        scheduler,
        jobSignal,
      );
      const report = await probe.ready();
      expect(report.checks.jobs).toBe('outbox-relay,test-run');
      expect(report.checks.jobSignal).toBe('listening');
    });

    it('la escucha de señales caída degrada a sondeo pero NO deja el proceso «no listo»', async () => {
      // Perder el LISTEN sube la latencia de los trabajos al intervalo de sondeo; el proceso
      // sigue procesando. Sacarlo de rotación por esto sería peor que el problema que avisa.
      const probe = new HealthProbeService(
        prismaOk,
        cacheOk,
        config({ WORKER_ROLE: 'ALL' }),
        scheduler,
        { enabled: true, connected: false } as unknown as JobSignalService,
      );
      const report = await probe.ready();
      expect(report.ready).toBe(true);
      expect(report.checks.jobSignal).toBe('polling');
    });

    it('con la base de datos caída devuelve NO listo en vez de lanzar', async () => {
      const probe = new HealthProbeService(
        {
          $queryRaw: () => Promise.reject(new Error('connect ECONNREFUSED 10.0.3.11:5432')),
        } as unknown as PrismaService,
        cacheOk,
        config(),
        scheduler,
        jobSignal,
      );
      const report = await probe.ready();
      expect(report.ready).toBe(false);
      expect(report.checks.database).toBe('error');
    });

    it('no filtra host, puerto ni texto del driver en la respuesta pública', async () => {
      const secreto = 'connect ECONNREFUSED postgres-primary.interno:5432';
      const probe = new HealthProbeService(
        { $queryRaw: () => Promise.reject(new Error(secreto)) } as unknown as PrismaService,
        cacheOk,
        config(),
        scheduler,
        jobSignal,
      );
      const report = await probe.ready();
      // Todo el cuerpo, serializado: si el mensaje del driver se colara por cualquier campo,
      // aparecería aquí.
      const body = JSON.stringify(report);
      expect(body).not.toContain('postgres-primary.interno');
      expect(body).not.toContain('5432');
      expect(body).not.toContain('ECONNREFUSED');
    });

    it('una caché caída también se reporta sin lanzar', async () => {
      const probe = new HealthProbeService(
        prismaOk,
        { ping: () => Promise.reject(new Error('redis down')) } as unknown as CacheService,
        config(),
        scheduler,
        jobSignal,
      );
      const report = await probe.ready();
      expect(report.ready).toBe(false);
      expect(report.checks.database).toBe('ok');
      expect(report.checks.cache).toBe('error');
    });
  });
});
