import { ConfigService } from '@nestjs/config';
import { DomainException } from '../src/common/errors/domain-exception';
import { ArtifactService } from '../src/modules/artifacts/artifact.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';

/**
 * `legalBasis` deriva la política de base habilitante que el runtime exige en cada decisión.
 * Un PATCH sobre una versión aprobada o desplegada la relajaba sin pasar por gobierno.
 */
describe('ArtifactService.updateProcessingBasis respeta el estado de la versión', () => {
  const principal = { id: 'qa', requestId: 'r-1', roles: ['QA_ANALYST'] } as AuthenticatedPrincipal;

  function make(status: string) {
    const update = jest.fn().mockResolvedValue({
      id: 1n,
      processingPurpose: 'p',
      legalBasis: 'CONTRACT',
      enablingBasisPolicy: null,
    });
    const tx = {
      decisionArtifactVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: 1n, status }),
        update,
      },
    };
    const prisma = { $transaction: (cb: (t: unknown) => unknown) => cb(tx) };
    const audit = { append: jest.fn().mockResolvedValue({}) };
    const service = new ArtifactService(prisma as never, audit as never, new ConfigService({}));
    return { service, update };
  }

  it.each(['APPROVED', 'DEPLOYED_TO_PROD', 'DEPLOYED_TO_TEST', 'IN_REVIEW', 'VALIDATED'])(
    'rechaza cambiar legalBasis en %s',
    async (status) => {
      const { service, update } = make(status);
      const error = await service
        .updateProcessingBasis(1n, 1n, { legalBasis: 'CONTRACT' }, principal)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(DomainException);
      expect((error as DomainException).code).toBe('PROCESSING_BASIS_LOCKED');
      expect((error as DomainException).status).toBe(409);
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('rechaza también borrar la base legal (null) y cambiar la finalidad en una versión desplegada', async () => {
    const { service, update } = make('DEPLOYED_TO_PROD');
    await expect(
      service.updateProcessingBasis(1n, 1n, { legalBasis: null }, principal),
    ).rejects.toMatchObject({ code: 'PROCESSING_BASIS_LOCKED' });
    await expect(
      service.updateProcessingBasis(1n, 1n, { processingPurpose: 'otra' }, principal),
    ).rejects.toMatchObject({ code: 'PROCESSING_BASIS_LOCKED' });
    expect(update).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'VALIDATION_FAILED'])('permite el cambio en %s', async (status) => {
    const { service, update } = make(status);
    await service.updateProcessingBasis(1n, 1n, { legalBasis: 'CONTRACT' }, principal);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
