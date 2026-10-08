import { ConfigService } from '@nestjs/config';
import { UnresolvedReevaluationService } from '../src/modules/workers/semantic-analysis/unresolved-reevaluation.service';

/**
 * La reevaluación automática cierra pendientes sin que nadie mire; estas pruebas fijan lo que NO
 * puede cerrar: lo que el pipeline degradó (cuota agotada, reloj vencido) y lo que una persona
 * resolvió mientras la pasada corría.
 */

function armar(resultado: Record<string, unknown>, filasAfectadas = 1) {
  const updateMany = jest.fn().mockResolvedValue({ count: filasAfectadas });
  const prisma = {
    unresolvedClassification: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 1n,
          rawValue: 'TRASPASO A JUAN',
          context: {},
          occurrenceCount: 3,
          status: 'PENDING',
        },
      ]),
      updateMany,
    },
  };
  const pipeline = { analyze: jest.fn().mockResolvedValue(resultado) };
  const servicio = new UnresolvedReevaluationService(
    prisma as never,
    pipeline as never,
    new ConfigService({ UNRESOLVED_HIGH_CONFIDENCE: 0.9, UNRESOLVED_AUTO_CLOSE_FLOOR: 0.75 }),
  );
  (servicio as unknown as { respirar: () => Promise<void> }).respirar = () => Promise.resolve();
  return { servicio, updateMany };
}

const base = {
  status: 'MATCH',
  matches: [{ categoryCode: 'GASTOS.TRANSFERENCIAS', confidence: 0.86 }],
  normalizedText: 'TRASPASO A JUAN',
  requiresReview: false,
  reviewReason: null,
};

describe('reevaluación de pendientes: guardas', () => {
  it('cierra un MATCH sano con confianza suficiente', async () => {
    const { servicio, updateMany } = armar(base);
    const resumen = await servicio.reevaluate(1n);
    expect(resumen.resueltos).toBe(1);
    expect(updateMany.mock.calls[0][0].data.status).toBe('AUTO_RESOLVED');
  });

  it.each(['PROCESSING_ERROR', 'TIMEOUT'])(
    'NO cierra un MATCH degradado por %s: no sale de la bandeja humana',
    async (reviewReason) => {
      const { servicio, updateMany } = armar({ ...base, requiresReview: true, reviewReason });
      const resumen = await servicio.reevaluate(1n);
      expect(resumen.resueltos).toBe(0);
      expect(updateMany.mock.calls.some(([a]) => a.data.status === 'AUTO_RESOLVED')).toBe(false);
    },
  );

  it('la regla por instrumento (LOW_CONFIDENCE de rescate) sigue cerrando: política medida', async () => {
    const { servicio } = armar({ ...base, requiresReview: true, reviewReason: 'LOW_CONFIDENCE' });
    expect((await servicio.reevaluate(1n)).resueltos).toBe(1);
  });

  it('el cierre y el refresco exigen que siga PENDING (no pisan una resolución humana)', async () => {
    const { servicio, updateMany } = armar(base, 0);
    const resumen = await servicio.reevaluate(1n);
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 1n, status: 'PENDING' });
    // Otra persona ya lo resolvió: ni se cuenta como resuelto por el catálogo.
    expect(resumen.resueltos).toBe(0);
  });
});
