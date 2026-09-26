import { WorkerRunStatus } from '@prisma/client';
import { IdentityReviewService } from '../src/modules/workers/identity-verification/review/identity-review.service';
import { DomainException } from '../src/common/errors/domain-exception';

/**
 * La firma de una persona sobre la IDENTIDAD, que es la etiqueta del corpus.
 *
 * Un caso llega a la cola por dos motivos que no se parecen: porque el clasificador no supo qué
 * documento era —duda sobre el DOCUMENTO— o porque el worker no pudo firmar el veredicto —duda
 * sobre la PERSONA—. Resolverlos con la acción del otro produciría una etiqueta que no mide nada,
 * y el corpus se construye con exactamente estas etiquetas, así que el corte se comprueba aquí.
 *
 * Lo que la persona firma va a `humanDecision` y NUNCA encima de `decision`: pisarlo perdería la
 * única comparación que dice si el worker acierta. Las dos columnas juntas, con el parecido, son
 * una fila del corpus.
 */
const PRINCIPAL = { id: 'revisora', requestId: 'req-1' };

function servicioCon(fila: Record<string, unknown>) {
  const escrituras: Record<string, unknown>[] = [];
  const auditado: Record<string, unknown>[] = [];
  const prisma = {
    identityVerificationRun: {
      findFirst: () => Promise.resolve(fila),
      update: ({ data }: { data: Record<string, unknown> }) => {
        escrituras.push(data);
        return Promise.resolve({});
      },
    },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        identityVerificationRun: {
          update: ({ data }: { data: Record<string, unknown> }) => {
            escrituras.push(data);
            return Promise.resolve({});
          },
        },
      }),
  };
  const audit = {
    append: (evento: Record<string, unknown>) => {
      auditado.push(evento);
      return Promise.resolve();
    },
  };
  const service = new IdentityReviewService(
    prisma as never,
    audit as never,
    { get: () => 100 } as never,
    { notifyDetached: () => undefined } as never,
  );
  return { service, escrituras, auditado };
}

/** Un caso que ya tiene veredicto: llegó a la cola porque nadie pudo firmarlo. */
const CON_VEREDICTO = {
  requestId: 'r1',
  status: WorkerRunStatus.IN_REVIEW,
  reviewClaimedBy: PRINCIPAL.id,
  reviewReason: 'UNCALIBRATED_DECISION',
  decision: 'REVIEW_REQUIRED',
  similarityScore: 0.639,
  arbitrationMode: 'HUMAN',
};

/** Un caso de la puerta: todavía nadie sabe qué documento es, así que no hay veredicto. */
const SIN_VEREDICTO = {
  ...CON_VEREDICTO,
  reviewReason: 'DOUBTFUL_DOCUMENT',
  decision: null,
  similarityScore: null,
};

describe('la firma humana sobre la identidad', () => {
  it('confirmar deja las DOS decisiones, sin pisar la del worker', async () => {
    const { service, escrituras } = servicioCon(CON_VEREDICTO);

    const salida = await service.resolve(
      1n,
      'r1',
      { action: 'CONFIRM_IDENTITY', notes: 'Es el titular.' } as never,
      PRINCIPAL as never,
    );

    expect(salida.status).toBe(WorkerRunStatus.SUCCEEDED);
    const escrito = escrituras.at(-1)!;
    expect(escrito.humanDecision).toBe('VERIFIED');
    expect(escrito.decision).toBeUndefined(); // el veredicto del worker queda intacto
    expect(escrito.reviewResolvedBy).toBe('revisora');
    // El motivo por el que ENTRÓ se conserva: es la mitad de la lectura del corpus.
    expect(escrito.reviewReason).toBeUndefined();
  });

  it('negar la identidad también es una etiqueta, y cierra el caso', async () => {
    const { service, escrituras } = servicioCon(CON_VEREDICTO);

    const salida = await service.resolve(
      1n,
      'r1',
      { action: 'DENY_IDENTITY', notes: 'No es la misma persona.' } as never,
      PRINCIPAL as never,
    );

    expect(salida.status).toBe(WorkerRunStatus.SUCCEEDED_WITH_WARNINGS);
    expect(escrituras.at(-1)!.humanDecision).toBe('NOT_VERIFIED');
  });

  it('la auditoría guarda las dos decisiones y el parecido, sin mezclarlas', async () => {
    const { service, auditado } = servicioCon(CON_VEREDICTO);

    await service.resolve(
      1n,
      'r1',
      { action: 'CONFIRM_IDENTITY', notes: 'Es el titular.' } as never,
      PRINCIPAL as never,
    );

    const payload = auditado.at(-1)!.payload as Record<string, unknown>;
    expect(payload.workerDecision).toBe('REVIEW_REQUIRED');
    expect(payload.humanDecision).toBe('VERIFIED');
    // Número y no `Decimal`: el canonizador de la cadena de auditoría rechaza lo que tenga
    // métodos, y eso sólo se descubre cuando alguien firma el primer caso.
    expect(typeof payload.similarityScore).toBe('number');
  });

  it('firmar la identidad de un caso que aún no tiene veredicto se rechaza', async () => {
    const { service } = servicioCon(SIN_VEREDICTO);

    const fallo = await service
      .resolve(1n, 'r1', { action: 'CONFIRM_IDENTITY', notes: 'x' } as never, PRINCIPAL as never)
      .catch((e: unknown) => e);

    expect(fallo).toBeInstanceOf(DomainException);
    expect((fallo as DomainException).code).toBe('IDENTITY_REVIEW_NO_VERDICT_YET');
  });

  it('nombrar el documento de un caso que ya tiene veredicto también se rechaza', async () => {
    const { service } = servicioCon(CON_VEREDICTO);

    const fallo = await service
      .resolve(
        1n,
        'r1',
        { action: 'CONFIRM_DOCUMENT', documentType: 'BOLIVIA_CI', notes: 'x' } as never,
        PRINCIPAL as never,
      )
      .catch((e: unknown) => e);

    expect(fallo).toBeInstanceOf(DomainException);
    expect((fallo as DomainException).code).toBe('IDENTITY_REVIEW_ALREADY_HAS_VERDICT');
  });
});
