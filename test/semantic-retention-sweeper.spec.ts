import { ConfigService } from '@nestjs/config';
import type { JobSchedulerService } from '../src/common/jobs/job-scheduler.service';
import { JobName } from '../src/common/jobs/job-names';
import type { AuditRetentionService } from '../src/modules/workers/semantic-analysis/core/application/audit-retention.service';
import { SemanticRetentionSweeperService } from '../src/modules/workers/semantic-analysis/semantic-retention-sweeper.service';

/**
 * La política de retención venía completa en el núcleo absorbido, pero nada la
 * ejecutaba: el planificador que la disparaba se descartó con pg-boss. El texto
 * analizado —que además sale del perímetro cuando el proveedor es alojado— se
 * conservaba indefinidamente. Estas pruebas fijan que vuelve a ejecutarse.
 */
describe('SemanticRetentionSweeperService', () => {
  function build(options: {
    role?: string;
    minimized?: number;
    deleted?: number;
    isEnabled?: boolean;
    apply?: () => Promise<{ minimized: number; deleted: number }>;
  }) {
    const register = jest.fn();
    const apply =
      options.apply ??
      jest.fn().mockResolvedValue({
        minimized: options.minimized ?? 0,
        deleted: options.deleted ?? 0,
      });
    const retention = {
      apply,
      get isEnabled() {
        return options.isEnabled ?? true;
      },
    } as unknown as AuditRetentionService;

    const sweeper = new SemanticRetentionSweeperService(
      new ConfigService({ WORKER_ROLE: options.role ?? 'WORKER' }),
      { register } as unknown as JobSchedulerService,
      retention,
    );
    return { sweeper, register, apply };
  }

  it('se registra en el orquestador cuando el proceso corre trabajos de fondo', () => {
    const { sweeper, register } = build({ role: 'WORKER' });
    sweeper.onModuleInit();

    expect(register).toHaveBeenCalledWith(sweeper);
    expect(sweeper.name).toBe(JobName.SemanticRetention);
  });

  // Una réplica de API no debe purgar: haría la misma consulta que el worker y
  // competiría con él por las mismas filas.
  it('no se registra en una réplica que solo sirve API', () => {
    const { sweeper, register } = build({ role: 'API' });
    sweeper.onModuleInit();

    expect(register).not.toHaveBeenCalled();
  });

  it('no se registra si ambos plazos están en cero', () => {
    const { sweeper, register } = build({ isEnabled: false });
    sweeper.onModuleInit();

    expect(register).not.toHaveBeenCalled();
  });

  it('devuelve el total de filas tocadas para que el orquestador encadene otra pasada', async () => {
    const { sweeper, apply } = build({ minimized: 7, deleted: 3 });

    await expect(sweeper.runOnce()).resolves.toBe(10);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  // Un fallo de base no debe tumbar el orquestador: las mismas filas vencen
  // igual en la pasada siguiente.
  it('absorbe un fallo de la barrida en vez de propagarlo', async () => {
    const { sweeper } = build({
      apply: jest.fn().mockRejectedValue(new Error('connection reset')),
    });

    await expect(sweeper.runOnce()).resolves.toBe(0);
  });

  // Cadencia fija: el retroceso adaptativo existe para drenar colas, no para una
  // purga que solo depende del reloj.
  it('usa una cadencia fija y no reacciona a ninguna señal', () => {
    const { sweeper } = build({});

    expect(sweeper.wakeChannel).toBeNull();
    expect(sweeper.minIdleIntervalMs).toBe(sweeper.maxIdleIntervalMs);
  });
});
