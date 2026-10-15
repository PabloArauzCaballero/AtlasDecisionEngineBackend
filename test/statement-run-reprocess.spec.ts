import { WorkerRunStatus } from '@prisma/client';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import { StatementReprocessService } from '../src/modules/workers/bank-statement/review/statement-reprocess.service';

/**
 * Volver a analizar una ejecución cerrada sin resultado (2026-10-15).
 *
 * En TEST una `SUCCEEDED_WITH_WARNINGS` sin resultado ni movimientos se quedaba así para siempre: la
 * deduplicación por huella se la devolvía a quien volvía a subir el PDF.
 */
describe('StatementReprocessService.reprocessRun', () => {
  const analista = {
    id: 'ana',
    requestId: 'req-1',
    roles: [],
  } as unknown as AuthenticatedPrincipal;

  function montar(run: Record<string, unknown> | null, copia = true) {
    const tx = {
      bankStatementRun: { update: jest.fn(async (_a: { data: Record<string, unknown> }) => ({})) },
    };
    const prisma = {
      bankStatementRun: { findFirst: jest.fn(async () => run) },
      financialInstitution: { findFirst: jest.fn(async () => null) },
      $transaction: (fn: (client: unknown) => Promise<unknown>) => fn(tx),
    };
    const audit = { append: jest.fn(async () => ({})) };
    const jobSignal = { notify: jest.fn(async () => undefined) };
    const documents = { ensureWorkingCopy: jest.fn(async () => copia) };
    const service = new StatementReprocessService(
      prisma as never,
      audit as never,
      jobSignal as never,
      {} as never,
      documents as never,
    );
    return { service, tx, audit, jobSignal, documents };
  }

  const cerradaSinNada = {
    status: WorkerRunStatus.SUCCEEDED_WITH_WARNINGS,
    resultJson: null,
    transactionCount: null,
  };

  it('la vuelve a la cola con la entidad asignada, restaurando el PDF, y lo audita', async () => {
    const { service, tx, audit, jobSignal, documents } = montar(cerradaSinNada);
    await expect(service.reprocessRun(3n, 'bs-1', analista, 'bga')).resolves.toEqual({
      requestId: 'bs-1',
      status: WorkerRunStatus.QUEUED,
    });
    expect(documents.ensureWorkingCopy).toHaveBeenCalledWith(3n, 'bs-1');
    const data = tx.bankStatementRun.update.mock.calls[0][0].data;
    expect(data).toMatchObject({
      status: WorkerRunStatus.QUEUED,
      assignedInstitutionCode: 'BGA',
      assignedInstitutionBy: 'ana',
      reviewResolvedAt: null,
    });
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'BANK_STATEMENT_RUN_REPROCESSED' }),
      tx,
    );
    expect(jobSignal.notify).toHaveBeenCalled();
  });

  it('no reabre una ejecución con resultado', async () => {
    const { service } = montar({
      status: WorkerRunStatus.SUCCEEDED,
      resultJson: {},
      transactionCount: 24,
    });
    await expect(service.reprocessRun(3n, 'bs-1', analista)).rejects.toThrow(/no dejó resultado/);
  });

  it('una entidad inventada no se guarda', async () => {
    const { service } = montar(cerradaSinNada);
    await expect(service.reprocessRun(3n, 'bs-1', analista, 'XYZ')).rejects.toThrow(/XYZ/);
  });

  it('sin PDF en ningún sitio, lo dice', async () => {
    const { service } = montar(cerradaSinNada, false);
    await expect(service.reprocessRun(3n, 'bs-1', analista)).rejects.toThrow(/ya no está guardado/);
  });
});
