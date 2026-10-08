import { AuditRetentionService } from '../src/modules/workers/semantic-analysis/core/application/audit-retention.service';
import type { AuditRetentionRepository } from '../src/modules/workers/semantic-analysis/core/application/ports';
import type { SemanticWorkerConfig } from '../src/modules/workers/semantic-analysis/core/config/semantic-worker.config';
import { PrismaAuditRetentionRepository } from '../src/modules/workers/semantic-analysis/adapters/prisma-budget.repository';

/**
 * `0` «desactiva la purga»: antes, con un solo plazo en 0 el sweeper seguía activo y
 * `daysAgo(0)` = now() borraba o minimizaba TODAS las ejecuciones terminadas.
 */
describe('AuditRetentionService con plazos en cero', () => {
  function build(retentionDays: number, minimizeDays: number) {
    const repository = {
      purgeOlderThan: jest.fn().mockResolvedValue(5),
      minimizeOlderThan: jest.fn().mockResolvedValue(4),
    } satisfies AuditRetentionRepository;
    const service = new AuditRetentionService(repository, {
      auditRetentionDays: retentionDays,
      auditMinimizeAfterDays: minimizeDays,
    } as SemanticWorkerConfig);
    return { service, repository };
  }

  it('retención 0 con minimización 30: no purga nada', async () => {
    const { service, repository } = build(0, 30);

    await expect(service.apply()).resolves.toEqual({ deleted: 0, minimized: 4 });
    expect(repository.purgeOlderThan).not.toHaveBeenCalled();
    expect(repository.minimizeOlderThan).toHaveBeenCalledWith(30);
  });

  it('minimización 0 con retención 90: no minimiza nada', async () => {
    const { service, repository } = build(90, 0);

    await expect(service.apply()).resolves.toEqual({ deleted: 5, minimized: 0 });
    expect(repository.minimizeOlderThan).not.toHaveBeenCalled();
    expect(repository.purgeOlderThan).toHaveBeenCalledWith(90);
  });

  it('con ambos plazos positivos aplica las dos operaciones', async () => {
    const { service, repository } = build(90, 30);

    await expect(service.apply()).resolves.toEqual({ deleted: 5, minimized: 4 });
    expect(repository.purgeOlderThan).toHaveBeenCalledWith(90);
    expect(repository.minimizeOlderThan).toHaveBeenCalledWith(30);
  });
});

describe('PrismaAuditRetentionRepository con plazo en cero', () => {
  it('no toca la base si el plazo no es positivo', async () => {
    const prisma = {
      semanticAnalysisRun: { deleteMany: jest.fn() },
      $transaction: jest.fn(),
      $executeRaw: jest.fn(),
    };
    const repository = new PrismaAuditRetentionRepository(prisma as never);

    await expect(repository.purgeOlderThan(0)).resolves.toBe(0);
    await expect(repository.minimizeOlderThan(0)).resolves.toBe(0);
    await expect(repository.purgeOlderThan(-3)).resolves.toBe(0);
    expect(prisma.semanticAnalysisRun.deleteMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
