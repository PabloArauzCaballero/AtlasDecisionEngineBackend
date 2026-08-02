import { ConfigService } from '@nestjs/config';
import {
  WORKER_ROLES,
  runsBackgroundJobs,
  servesHttp,
  workerRoleOf,
} from '../src/common/config/worker-role';
import { envSchema } from '../src/common/config/env.schema';

/**
 * El reparto de responsabilidades entre procesos decide qué corre dónde, así que un fallo
 * aquí no es cosmético: o el trabajo de fondo se ejecuta en las réplicas de latencia, o no
 * se ejecuta en ninguna parte y la cola crece sin que nadie lo note.
 */
describe('WORKER_ROLE', () => {
  it('sin declarar equivale a ALL: no cambia un despliegue existente', () => {
    const config = new ConfigService({});
    expect(workerRoleOf(config)).toBe('ALL');
    expect(runsBackgroundJobs(config)).toBe(true);
    expect(servesHttp(config)).toBe(true);
  });

  it('API sirve HTTP y no corre trabajos de fondo', () => {
    const config = new ConfigService({ WORKER_ROLE: 'API' });
    expect(servesHttp(config)).toBe(true);
    expect(runsBackgroundJobs(config)).toBe(false);
  });

  it('WORKER corre trabajos de fondo y no sirve HTTP de negocio', () => {
    const config = new ConfigService({ WORKER_ROLE: 'WORKER' });
    expect(servesHttp(config)).toBe(false);
    expect(runsBackgroundJobs(config)).toBe(true);
  });

  it('normaliza mayúsculas y espacios', () => {
    expect(workerRoleOf(new ConfigService({ WORKER_ROLE: '  worker ' }))).toBe('WORKER');
  });

  it('un valor desconocido cae a ALL en vez de dejar el proceso sin trabajos', () => {
    // Falla ABIERTO a propósito, al revés que la seguridad: si el rol es ilegible, el peor
    // resultado posible es una cola que nadie drena. El env schema ya rechaza el valor
    // antes de llegar aquí; esto solo cubre un ConfigService construido a mano.
    expect(workerRoleOf(new ConfigService({ WORKER_ROLE: 'MAESTRO' }))).toBe('ALL');
  });

  it('el env schema solo admite los roles del catálogo', () => {
    const base = {
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      AUDIT_HASH_SECRET: 'x'.repeat(32),
      MANAGEMENT_API_KEY: 'm'.repeat(24),
      RUNTIME_API_KEY: 'r'.repeat(24),
    };
    for (const role of WORKER_ROLES) {
      expect(envSchema.parse({ ...base, WORKER_ROLE: role }).WORKER_ROLE).toBe(role);
    }
    expect(() => envSchema.parse({ ...base, WORKER_ROLE: 'MAESTRO' })).toThrow();
  });

  it('declara el puerto de sondas del worker con un valor por defecto propio', () => {
    // Un proceso sin puerto no se puede sondear, y sin sonda el orquestador no sabe si
    // reiniciarlo: el worker necesita el suyo, distinto del de la API.
    const parsed = envSchema.parse({
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      AUDIT_HASH_SECRET: 'x'.repeat(32),
      MANAGEMENT_API_KEY: 'm'.repeat(24),
      RUNTIME_API_KEY: 'r'.repeat(24),
    });
    expect(parsed.WORKER_HEALTH_PORT).toBe(3001);
    expect(parsed.PORT).not.toBe(parsed.WORKER_HEALTH_PORT);
  });
});
