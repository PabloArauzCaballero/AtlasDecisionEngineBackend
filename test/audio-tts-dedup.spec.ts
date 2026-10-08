import { Prisma, WorkerInputSource, WorkerRunStatus } from '@prisma/client';
import { AudioTtsService } from '../src/modules/workers/audio-tts/audio-tts.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';

/**
 * Reenviar la misma locución: un resultado se reutiliza, un intento sin resultado se reintenta.
 * La clave de idempotencia se deriva del contenido y no caduca; sin esto, una locución fallida por
 * presupuesto de fin de mes o por una caída del proveedor respondía con aquel fallo para siempre.
 */

const PRINCIPAL = {
  id: 'analista@atlas',
  requestId: 'req-nuevo',
} as unknown as AuthenticatedPrincipal;
const ENTRADA = {
  idempotencyKey: 'clave',
  templateCode: 'saludo',
  variables: {},
  language: 'es',
} as never;

function servicioCon(existente: { status: WorkerRunStatus; requestId: string }) {
  const actualizaciones: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> =
    [];
  let notificaciones = 0;
  let filas = 1;
  const tx = {
    audioTtsRun: {
      create: () => {
        throw new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'prueba',
        });
      },
      updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        actualizaciones.push(args);
        const count = filas;
        filas = 0; // un segundo reenvío simultáneo ya no encuentra el estado terminal
        return Promise.resolve({ count });
      },
      findFirst: () => Promise.resolve({ ...existente, status: WorkerRunStatus.QUEUED }),
    },
  };
  const prisma = {
    audioTtsRun: { findFirst: () => Promise.resolve(existente) },
    $transaction: (work: (t: unknown) => Promise<unknown>) => work(tx),
  };
  const service = new AudioTtsService(
    prisma as never,
    { notify: () => ((notificaciones += 1), Promise.resolve()) } as never,
    { get: () => undefined } as never,
    { inject: () => ({}) } as never,
    {} as never,
  );
  (service as unknown as { ensureDefaultTemplates: () => Promise<void> }).ensureDefaultTemplates =
    () => Promise.resolve();
  return { service, actualizaciones, notificaciones: () => notificaciones };
}

describe('alta de una locución ya pedida', () => {
  it.each([WorkerRunStatus.FAILED, WorkerRunStatus.CANCELLED])(
    'reencola la ejecución %s en vez de devolver el fallo antiguo',
    async (status) => {
      const { service, actualizaciones, notificaciones } = servicioCon({
        status,
        requestId: 'req-viejo',
      });

      const { run, deduplicated } = await service.createRun(
        1n,
        PRINCIPAL,
        ENTRADA,
        WorkerInputSource.UPLOAD,
      );

      expect(deduplicated).toBe(false);
      expect(run.status).toBe(WorkerRunStatus.QUEUED);
      expect(actualizaciones[0]?.data.attemptCount).toBe(0);
      expect(actualizaciones[0]?.data.errorCode).toBeNull();
      expect(notificaciones()).toBe(1);
    },
  );

  it('una ejecución terminada con resultado se reutiliza sin reencolar', async () => {
    const { service, actualizaciones } = servicioCon({
      status: WorkerRunStatus.SUCCEEDED,
      requestId: 'req-viejo',
    });

    const { run, deduplicated } = await service.createRun(
      1n,
      PRINCIPAL,
      ENTRADA,
      WorkerInputSource.UPLOAD,
    );

    expect(deduplicated).toBe(true);
    expect(run.requestId).toBe('req-viejo');
    expect(actualizaciones).toHaveLength(0);
  });
});
