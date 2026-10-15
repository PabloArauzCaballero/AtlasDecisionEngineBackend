import { WorkerInputSource, WorkerRunStatus } from '@prisma/client';
import { BankStatementController } from '../src/modules/workers/bank-statement/bank-statement.controller';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';

/**
 * La respuesta de `POST /v1/workers/bank-statement/runs` dice si el archivo YA estaba.
 *
 * 2026-10-15: subir en la consola el mismo PDF que ya estaba en revisión devolvía esa ejecución
 * antigua sin decirlo, la consola anunciaba «encolado» y quien lo subía esperaba un análisis nuevo
 * que nunca llegaba.
 */
const PRINCIPAL = { id: 'analista@atlas', requestId: 'r' } as unknown as AuthenticatedPrincipal;

function fila(status: WorkerRunStatus) {
  return {
    requestId: 'bs-1',
    status,
    progress: 0,
    inputSource: WorkerInputSource.UPLOAD,
    fixtureCode: null,
    attemptCount: 1,
    queuedAt: new Date('2026-10-07T22:26:15Z'),
    startedAt: null,
    finishedAt: null,
    requestedBy: 'bootstrap-management',
    correlationId: 'c',
    resultJson: null,
    warningsJson: null,
    errorCode: 'UNSUPPORTED_INSTITUTION',
    errorMessage: null,
    reviewReason: 'UNKNOWN_BANK',
    rejectionReason: null,
    reviewPriority: 2,
  };
}

function montar(deduplicated: boolean) {
  const intake = {
    createRun: jest.fn(async () => ({ run: fila(WorkerRunStatus.IN_REVIEW), deduplicated })),
  };
  const uploads = { maxUploadBytes: () => 10_485_760 };
  const controller = new BankStatementController(
    intake as never,
    {} as never,
    uploads as never,
    {} as never,
  );
  return controller;
}

const archivo = {
  originalname: 'extracto.pdf',
  buffer: Buffer.from('%PDF-1.4\n%%EOF\n'),
  size: 15,
};

describe('POST runs · el archivo repetido se anuncia', () => {
  it('marca `deduplicated` cuando el motor devuelve la ejecución que ya existía', async () => {
    const respuesta = await montar(true).createRun(7n, PRINCIPAL, {}, archivo);
    expect(respuesta).toMatchObject({
      requestId: 'bs-1',
      status: WorkerRunStatus.IN_REVIEW,
      deduplicated: true,
    });
  });

  it('una ejecución nueva sale con `deduplicated: false`', async () => {
    const respuesta = await montar(false).createRun(7n, PRINCIPAL, {}, archivo);
    expect(respuesta.deduplicated).toBe(false);
  });
});
