import { Prisma, WorkerInputSource, WorkerRunStatus } from '@prisma/client';
import { IdentityVerificationService } from '../src/modules/workers/identity-verification/identity-verification.service';
import type { IdentityVerificationOutcome } from '../src/modules/workers/identity-verification/identity-result';

/**
 * La evidencia de una verificación hecha por un nodo `WORKER` del grafo.
 *
 * Por el nodo, la cara y el carnet se analizaban y se perdían: la decisión guardaba las variables
 * sensibles sólo como huella y el detalle de la ejecución no tenía nada que enseñar. Ahora se
 * conservan en el mismo almacén que una subida, en una fila que nace cerrada. Datos sintéticos.
 */

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('imagen-sintetica'),
]);
const imagen = (fileName: string) => ({ fileName, contentType: 'image/png' as const, bytes: PNG });
const ENTRADA = {
  document: imagen('carnet.jpg'),
  documentBack: null,
  selfie: imagen('selfie.jpg'),
  inputHash: 'huella-del-nodo',
};
const PRINCIPAL = { id: 'motor', requestId: 'req-decision-1' };
const VEREDICTO = {
  decision: 'REVIEW_REQUIRED',
  documentType: 'BOLIVIA_CI',
  reasonCodes: ['FACE_NO_MATCH'],
  riskFlags: ['DOCUMENT_GRAYSCALE'],
  documentEvidence: { confidence: 0.9 },
  faceMatch: { similarityScore: 0.41 },
} as unknown as IdentityVerificationOutcome;

function almacen() {
  return {
    isConfigured: () => true,
    buildIdentityKey: ({ requestId, kind }: { requestId: string; kind: string }) =>
      `t1/${requestId}/${kind}`,
    put: jest.fn().mockResolvedValue({ sha256Hex: 'sha' }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
}

function servicio(prisma: unknown, storage: unknown) {
  const nada = {} as never;
  return new IdentityVerificationService(prisma as never, nada, nada, nada, storage as never);
}

describe('evidencia de identidad de un nodo del grafo', () => {
  it('guarda las imágenes y crea la corrida ya cerrada, fuera de la bandeja de revisión', async () => {
    const create = jest.fn().mockResolvedValue({ id: 1n });
    const storage = almacen();

    const requestId = await servicio(
      { identityVerificationRun: { create } },
      storage,
    ).recordInlineEvidence(1n, PRINCIPAL as never, ENTRADA, VEREDICTO, 'BO');

    expect(requestId).toEqual(expect.any(String));
    expect(storage.put).toHaveBeenCalledTimes(2);
    const { data } = create.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data).toMatchObject({
      requestId,
      inputSource: WorkerInputSource.INLINE,
      status: WorkerRunStatus.SUCCEEDED_WITH_WARNINGS,
      progress: 100,
      decision: 'REVIEW_REQUIRED',
      documentObjectKey: `t1/${String(requestId)}/document`,
      selfieObjectKey: `t1/${String(requestId)}/selfie`,
      documentBackObjectKey: null,
    });
    // Ni motivo ni prioridad de revisión: enrutar a una persona es cosa del grafo.
    expect(data.reviewReason).toBeUndefined();
    expect(data.reviewPriority).toBeUndefined();
    // Las columnas `Bytes` sólo existían para el worker: aquí no se rellenan.
    expect(data.documentBytes).toBeUndefined();
    expect(data.selfieBytes).toBeUndefined();
  });

  it('las mismas fotos reutilizan la corrida existente y no dejan objetos huérfanos', async () => {
    const choque = new Prisma.PrismaClientKnownRequestError('duplicado', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const storage = almacen();
    const prisma = {
      identityVerificationRun: {
        create: jest.fn().mockRejectedValue(choque),
        findFirst: jest.fn().mockResolvedValue({ requestId: 'corrida-previa' }),
      },
    };

    const requestId = await servicio(prisma, storage).recordInlineEvidence(
      1n,
      PRINCIPAL as never,
      ENTRADA,
      VEREDICTO,
      'BO',
    );

    expect(requestId).toBe('corrida-previa');
    expect(storage.remove).toHaveBeenCalledTimes(2);
  });

  it('sin almacén no toca la base y devuelve null', async () => {
    const prisma = new Proxy(
      {},
      {
        get(): never {
          throw new Error('Sin almacén no se escribe ninguna fila.');
        },
      },
    );

    const requestId = await servicio(prisma, { isConfigured: () => false }).recordInlineEvidence(
      1n,
      PRINCIPAL as never,
      ENTRADA,
      VEREDICTO,
      'BO',
    );

    expect(requestId).toBeNull();
  });
});
