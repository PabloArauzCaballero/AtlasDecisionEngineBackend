import { ConfigService } from '@nestjs/config';
import { ManualReviewService } from '../src/modules/manual-review/manual-review.service';

/**
 * AtlasBackend guarda el CÓDIGO del caso (`MR-…`) y pregunta por él: `GET /v1/manual-reviews/MR-…`.
 * La ruta sólo aceptaba el id numérico, así que respondía 400 `INVALID_ID` siempre y la
 * sincronización de comercios nunca se enteraba de lo que una persona había decidido en el Motor:
 * el expediente quedaba «en revisión» para siempre. El código y el id deben abrir el mismo caso.
 */
describe('ManualReviewService.resolveCaseId', () => {
  function make(byCode: unknown) {
    const prisma: any = {
      decisionManualReviewCase: { findFirst: async () => byCode },
    };
    return new ManualReviewService(
      prisma,
      { append: async () => ({}) } as any,
      new ConfigService({}),
      {
        solicitar: async () => undefined,
      } as any,
    );
  }

  it('resuelve el código MR-… al id y acepta el id numérico', async () => {
    const service = make({ id: 42n });
    await expect(service.resolveCaseId(1n, 'MR-0000088001')).resolves.toBe(42n);
    await expect(service.resolveCaseId(1n, 'mr-0000088001')).resolves.toBe(42n);
    await expect(service.resolveCaseId(1n, '12')).resolves.toBe(12n);
  });

  it('un id que no es ni número ni código es 400, y un código sin caso es 404', async () => {
    await expect(make(null).resolveCaseId(1n, 'abc')).rejects.toMatchObject({ code: 'INVALID_ID' });
    await expect(make(null).resolveCaseId(1n, 'MR-9')).rejects.toMatchObject({
      code: 'MANUAL_REVIEW_NOT_FOUND',
    });
  });
});
