import { DeploymentResolverService } from '../src/modules/deployments/deployment-resolver.service';

describe('DeploymentResolverService', () => {
  it('no resuelve un binding cuyo despliegue ya fue suspendido', async () => {
    const prisma = {
      decisionRuntimeBinding: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const cache = {
      getForTenant: jest.fn().mockResolvedValue(null),
      setForTenant: jest.fn(),
    };
    const service = new DeploymentResolverService(prisma as never, cache as never);

    await expect(service.resolve(1n, 'CREDIT', 'TEST')).rejects.toMatchObject({
      code: 'ACTIVE_DEPLOYMENT_NOT_FOUND',
    });
    expect(prisma.decisionRuntimeBinding.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          activeDeployment: expect.objectContaining({ isActive: true, deploymentStatus: 'ACTIVE' }),
        }),
      }),
    );
    expect(cache.setForTenant).not.toHaveBeenCalled();
  });

  it('evicts a corrupt cache entry and resolves from the authoritative database', async () => {
    const binding = {
      environmentId: 3n,
      // La política de sujeto y el dominio de riesgo viajan con el despliegue: son datos del
      // binding —cambian cuando cambia el despliegue, no entre peticiones— y consultarlos aparte
      // costaría una consulta más en el camino caliente de CADA decisión.
      environment: { code: 'TEST', subjectReferencePolicy: 'WARN' },
      activeDeployment: {
        id: 4n,
        artifactVersionId: 5n,
        compiledArtifactId: 6n,
        artifactVersion: {
          subjectReferencePolicy: null,
          subjectPolicyJustification: null,
          artifact: { riskDomain: 'CREDIT_ORIGINATION' },
        },
        compiledArtifact: {
          compiledChecksum: 'checksum',
          compiledPayloadJson: { startNodeKey: 'START', nodes: {}, edgesByNode: {} },
        },
      },
    };
    const prisma = {
      decisionRuntimeBinding: { findFirst: jest.fn().mockResolvedValue(binding) },
    };
    const cache = {
      getForTenant: jest.fn().mockResolvedValue('{broken-json'),
      delForTenant: jest.fn().mockResolvedValue(undefined),
      setForTenant: jest.fn().mockResolvedValue(undefined),
    };
    const service = new DeploymentResolverService(prisma as never, cache as never);

    await expect(service.resolve(1n, 'CREDIT', 'TEST')).resolves.toMatchObject({
      deploymentId: 4n,
      compiledArtifactId: 6n,
      environmentCode: 'TEST',
    });
    expect(cache.delForTenant).toHaveBeenCalled();
    expect(prisma.decisionRuntimeBinding.findFirst).toHaveBeenCalled();
  });
});
