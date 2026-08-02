import { DeploymentResolverService } from '../src/modules/deployments/deployment-resolver.service';

describe('DeploymentResolverService', () => {
  it('evicts a corrupt cache entry and resolves from the authoritative database', async () => {
    const binding = {
      environmentId: 3n,
      environment: { code: 'TEST' },
      activeDeployment: {
        id: 4n,
        artifactVersionId: 5n,
        compiledArtifactId: 6n,
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
