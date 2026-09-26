import { ConfigService } from '@nestjs/config';
import { SeedingService } from '../src/modules/seeding/seeding.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import * as clientes from '../src/common/seeding/seed-local-clients';

/**
 * Una instalación SIN base publicadora tiene que registrar sus credenciales igual.
 *
 * El registro vivía después del `return` por «no hay `SEED_SOURCE_*`», así que quien instalaba la
 * plataforma sin base publicadora —lo normal fuera de este proyecto— arrancaba **sin ninguna
 * credencial registrada**. La identidad de un llamante por clave de API vive en la base, así que
 * la plataforma contestaba 401 a TODO aunque el operador hubiera puesto su `MANAGEMENT_API_KEY` en
 * el entorno, y el único rastro era «Startup seeding skipped: no SEED_SOURCE_* configured», que
 * habla de semillas y no de identidad.
 *
 * Son dos cosas independientes y esta prueba las separa: la identidad sale del ENTORNO de la
 * instalación, el catálogo de la base publicadora. La documentación de `SeedingService` ya lo decía
 * —«se hace SIEMPRE»—; lo que faltaba era que el código lo cumpliera.
 */
describe('SeedingService: credenciales sin base publicadora', () => {
  const prisma = {} as PrismaService;
  const sinFuente = [
    'SEED_SOURCE_DATABASE_URL',
    'SEED_SOURCE_HOST',
    'SEED_SOURCE_DB',
    'SEED_SOURCE_USER',
    'SEED_SOURCE_PASSWORD',
  ];
  const previo: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const clave of sinFuente) {
      previo[clave] = process.env[clave];
      delete process.env[clave];
    }
  });

  afterEach(() => {
    for (const clave of sinFuente) {
      if (previo[clave] === undefined) delete process.env[clave];
      else process.env[clave] = previo[clave];
    }
    jest.restoreAllMocks();
  });

  function servicio(overrides: Record<string, unknown> = {}): SeedingService {
    // `STARTUP_SEED_ENABLED` explícito: por omisión la siembra se apaga con `NODE_ENV=test`, que es
    // donde corre esta prueba, y entonces no se registraría nada por un motivo distinto del que se
    // quiere medir.
    const config = new ConfigService({ STARTUP_SEED_ENABLED: true, ...overrides });
    return new SeedingService(prisma, config);
  }

  it('registra los clientes de integración aunque no haya SEED_SOURCE_*', async () => {
    const registro = jest
      .spyOn(clientes, 'seedIntegrationClients')
      .mockResolvedValue([{ clientKey: 'bootstrap-management', roles: ['RISK_ANALYST'] }] as never);

    await servicio().onApplicationBootstrap();

    expect(registro).toHaveBeenCalledTimes(1);
  });

  it('no toca la base si el proceso no hace trabajo de fondo', async () => {
    // Una réplica de API no siembra: pagaría una ronda antes de aceptar su primera petición, y N
    // réplicas competirían por el mismo trabajo. La puerta de `WORKER_ROLE` sigue mandando.
    const registro = jest.spyOn(clientes, 'seedIntegrationClients').mockResolvedValue([] as never);

    await servicio({ WORKER_ROLE: 'API' }).onApplicationBootstrap();

    expect(registro).not.toHaveBeenCalled();
  });

  it('un fallo al registrar credenciales aborta el arranque', async () => {
    // Arrancar sin identidad es peor que no arrancar: la plataforma quedaría en pie contestando
    // 401 a todo, que se lee como un problema de quien llama.
    jest
      .spyOn(clientes, 'seedIntegrationClients')
      .mockRejectedValue(new Error('la base no acepta escrituras'));

    await expect(servicio().onApplicationBootstrap()).rejects.toThrow(
      /la base no acepta escrituras/,
    );
  });
});
