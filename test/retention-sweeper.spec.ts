import { ConfigService } from '@nestjs/config';
import type { JobSchedulerService } from '../src/common/jobs/job-scheduler.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { RetentionSweeperService } from '../src/modules/runtime/retention-sweeper.service';

const fakeScheduler = { register: jest.fn() } as unknown as JobSchedulerService;

describe('RetentionSweeperService', () => {
  /**
   * Doble mínimo del cliente Prisma.
   *
   * El `$transaction` no es decoración: `decision_runtime_idempotency` tiene RLS FORZADA y
   * una sentencia cruda suelta no fija `app.tenant_id`, así que sobre una conexión del pool
   * que ya sirvió a un tenant la política aborta con 22P02 (ver
   * `test/rls-guc-contamination.integration.spec.ts`). El doble reproduce la forma real
   * —array de operaciones dentro, array de resultados fuera— para que la prueba falle si
   * alguien vuelve a sacar la sentencia de la transacción.
   */
  function prismaDouble($executeRaw: jest.Mock) {
    return {
      $executeRaw,
      $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
    };
  }

  function sweeper(prisma: unknown): RetentionSweeperService {
    return new RetentionSweeperService(
      prisma as PrismaService,
      new ConfigService({ RUNTIME_RETENTION_SWEEP_BATCH: 100 }),
      fakeScheduler,
    );
  }

  // El orquestador —no el servicio— es quien ahora encadena lotes sucesivos mientras
  // sweep() devuelva > 0; una sola llamada aquí ejercita exactamente un lote.
  it('purges one bounded batch and returns how many rows it deleted', async () => {
    const $executeRaw = jest.fn().mockResolvedValueOnce(100);
    const purged = await sweeper(prismaDouble($executeRaw)).sweep();

    expect(purged).toBe(100);
    expect($executeRaw).toHaveBeenCalledTimes(1);
  });

  it('returns zero when nothing is due', async () => {
    const $executeRaw = jest.fn().mockResolvedValueOnce(0);
    const purged = await sweeper(prismaDouble($executeRaw)).sweep();

    expect(purged).toBe(0);
    expect($executeRaw).toHaveBeenCalledTimes(1);
  });

  it('swallows a database failure instead of throwing', async () => {
    const $executeRaw = jest.fn().mockRejectedValue(new Error('connection reset'));

    await expect(sweeper(prismaDouble($executeRaw)).sweep()).resolves.toBe(0);
  });

  it('emite el borrado DENTRO de una transacción, no como sentencia suelta', async () => {
    const $executeRaw = jest.fn().mockResolvedValueOnce(7);
    const $transaction = jest.fn((operations: Promise<unknown>[]) => Promise.all(operations));

    await sweeper({ $executeRaw, $transaction }).sweep();

    // Sin esto la RLS no se aplica y la purga falla de forma intermitente según qué conexión
    // del pool toque. Ver la nota en `retention-sweeper.service.ts`.
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});
