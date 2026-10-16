import { StatementRejectionReason, StatementReviewReason, WorkerRunStatus } from '@prisma/client';
import { BankStatementRunWorkerService } from '../src/modules/workers/bank-statement/bank-statement-run-worker.service';
import { holderConflict } from '../src/modules/workers/bank-statement/expected-holder';

/**
 * El titular del extracto es el cliente que lo sube (2026-10-16): qué hace el worker con cada veredicto y qué
 * hace el alta cuando el mismo PDF llega pidiendo otro titular.
 */
type Fila = {
  expectedHolderName: string | null;
  expectedHolderGivenNames: string | null;
  expectedHolderSurnames: string | null;
};

function montar(fila: Fila, holderName: string | null, confianza = 0.95) {
  const store = {
    startHeartbeat: jest.fn(() => setInterval(() => undefined, 1_000_000)),
    loadInput: jest.fn(async () => ({
      tenantId: 1n,
      fileBytes: new Uint8Array([1, 2, 3]),
      fileName: 'extracto.pdf',
      attemptCount: 1,
      correlationId: 'c',
      assignedInstitutionCode: null,
      ...fila,
    })),
    setProgress: jest.fn(async () => undefined),
    complete: jest.fn(async () => undefined),
    closeRun: jest.fn(async () => undefined),
    failOrRequeue: jest.fn(async () => undefined),
  };
  const normalized = {
    account: { holderName },
    quality: { overallConfidence: confianza, errors: [], warnings: [] },
    transactions: [{}, {}],
  };
  const config = { get: jest.fn(() => undefined) };
  const institutions = { ensureLoaded: jest.fn(async () => undefined) };
  const worker = new BankStatementRunWorkerService(
    config as never,
    {} as never,
    {} as never,
    institutions as never,
    store as never,
    {} as never,
  );
  (worker as unknown as { engines: Map<string, unknown> }).engines.set('1', {
    normalize: jest.fn(async () => normalized),
  });
  const ejecutar = () =>
    (worker as unknown as { execute: (id: bigint) => Promise<void> }).execute(7n);
  return { store, ejecutar };
}

const juan: Fila = {
  expectedHolderName: 'Juan Carlos Pérez Gómez',
  expectedHolderGivenNames: 'Juan Carlos',
  expectedHolderSurnames: 'Pérez Gómez',
};
const nadie: Fila = {
  expectedHolderName: null,
  expectedHolderGivenNames: null,
  expectedHolderSurnames: null,
};

describe('worker de extractos · el titular', () => {
  it('coincide: se cierra como siempre y guarda lo leído', async () => {
    const { store, ejecutar } = montar(juan, 'PEREZ GOMEZ JUAN CARLOS');
    await ejecutar();
    expect(store.complete).toHaveBeenCalledTimes(1);
    const [, , , holder] = store.complete.mock.calls[0] as unknown as [
      unknown,
      unknown,
      unknown,
      Record<string, unknown>,
    ];
    expect(holder).toEqual({ holderNameRead: 'PEREZ GOMEZ JUAN CARLOS', holderVerdict: 'MATCH' });
  });

  it('otra persona: rechazo HOLDER_MISMATCH, sin resultado aplicable', async () => {
    const { store, ejecutar } = montar(juan, 'MARIA LOPEZ ROJAS');
    await ejecutar();
    expect(store.complete).not.toHaveBeenCalled();
    const [, outcome, code, , provisional, holder] = store.closeRun.mock.calls[0] as unknown as [
      unknown,
      { status: string; rejectionReason: string },
      string,
      string,
      unknown,
      Record<string, unknown>,
    ];
    expect(outcome.status).toBe(WorkerRunStatus.PDF_INVALID);
    expect(outcome.rejectionReason).toBe(StatementRejectionReason.HOLDER_MISMATCH);
    expect(code).toBe('HOLDER_MISMATCH');
    expect(provisional).toBeUndefined();
    expect(holder.holderVerdict).toBe('MISMATCH');
  });

  it('titular ilegible: a una persona, con el análisis como provisional', async () => {
    const { store, ejecutar } = montar(juan, 'BANCO UNION S.A.');
    await ejecutar();
    const [, outcome, code, , provisional] = store.closeRun.mock.calls[0] as unknown as [
      unknown,
      { status: string; reviewReason: string },
      string,
      string,
      unknown,
    ];
    expect(outcome.status).toBe(WorkerRunStatus.PENDING_REVIEW);
    expect(outcome.reviewReason).toBe(StatementReviewReason.HOLDER_UNREADABLE);
    expect(code).toBe('HOLDER_UNREADABLE');
    expect(provisional).toBeDefined();
  });

  it('sin titular exigido (Consola): no decide nada, sólo informa', async () => {
    const { store, ejecutar } = montar(nadie, 'MARIA LOPEZ ROJAS');
    await ejecutar();
    const [, , , holder] = store.complete.mock.calls[0] as unknown as [
      unknown,
      unknown,
      unknown,
      Record<string, unknown>,
    ];
    expect(holder.holderVerdict).toBe('NOT_REQUIRED');
  });
});

describe('holderConflict · el mismo PDF pedido para otro titular', () => {
  const pide = (name: string) => ({ name, givenNames: null, surnames: null });
  const fila = (status: WorkerRunStatus, expectedHolderName: string | null, resuelta = false) => ({
    status,
    expectedHolderName,
    reviewResolvedAt: resuelta ? new Date() : null,
  });

  it('mismo titular (otro orden, sin tildes) o ninguno exigido: deduplicación de siempre', () => {
    expect(
      holderConflict(fila(WorkerRunStatus.SUCCEEDED, 'Juan Pérez'), pide('PEREZ JUAN')),
    ).toBeNull();
    expect(holderConflict(fila(WorkerRunStatus.SUCCEEDED, 'Juan Pérez'), null)).toBeNull();
  });

  it('terminada para otro: se reanaliza contra el nuevo', () => {
    expect(holderConflict(fila(WorkerRunStatus.SUCCEEDED, 'Juan Pérez'), pide('María López'))).toBe(
      'requeue',
    );
  });

  it('en curso o resuelta por una persona para otro: conflicto', () => {
    expect(
      holderConflict(fila(WorkerRunStatus.PENDING_REVIEW, 'Juan Pérez'), pide('María López')),
    ).toBe('conflict');
    expect(
      holderConflict(fila(WorkerRunStatus.SUCCEEDED, 'Juan Pérez', true), pide('María López')),
    ).toBe('conflict');
  });

  it('de la Consola y en curso: se le fija el titular', () => {
    expect(holderConflict(fila(WorkerRunStatus.QUEUED, null), pide('María López'))).toBe('pin');
  });
});
