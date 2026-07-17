import type { DeploymentResolverService } from '../src/modules/deployments/deployment-resolver.service';
import type { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { SimulationService } from '../src/modules/runtime/simulation.service';
import type { VariableResolutionService } from '../src/modules/variables/variable-resolution.service';

describe('SimulationService', () => {
  const compiled = {
    variables: [
      { code: 'age', usageType: 'INPUT' },
      { code: 'decision', usageType: 'OUTPUT' },
    ],
    nodes: {},
    edgesByNode: {},
  };
  const deployment = {
    deploymentId: 21n,
    artifactVersionId: 11n,
    environmentId: 3n,
    environmentCode: 'SANDBOX',
    compiledArtifactId: 31n,
    compiledChecksum: 'checksum-123',
    compiled,
  };

  function setup() {
    const deployments = { resolve: jest.fn().mockResolvedValue(deployment) };
    const variables = {
      resolve: jest.fn().mockResolvedValue({ valid: true, values: { age: 30 }, errors: [] }),
    };
    const engine = {
      execute: jest.fn().mockResolvedValue({
        status: 'SUCCESS',
        outcome: 'APPROVED',
        output: { decision: 'APPROVED' },
        primaryResult: { code: 'decision', value: 'APPROVED' },
        reasons: [],
        visitedNodeKeys: ['START', 'APPROVE'],
        traversedEdgeKeys: ['START_APPROVE'],
        terminalNodeKey: 'APPROVE',
      }),
    };
    const service = new SimulationService(
      deployments as unknown as DeploymentResolverService,
      variables as unknown as VariableResolutionService,
      engine as unknown as ExecutionEngineService,
    );
    return { service, deployments, variables, engine };
  }

  it('returns a deterministic trace without a persistence dependency', async () => {
    const { service, deployments, variables, engine } = setup();

    const result = await service.simulate(7n, 'CREDIT_POLICY', {
      requestId: 'simulation-request-1',
      environmentCode: 'sandbox',
      variables: { age: 30 },
    });

    expect(deployments.resolve).toHaveBeenCalledWith(7n, 'CREDIT_POLICY', 'SANDBOX');
    expect(variables.resolve).toHaveBeenCalledWith(
      [compiled.variables[0]],
      { age: 30 },
      expect.objectContaining({ allowExternal: false }),
    );
    expect(engine.execute).toHaveBeenCalledWith(compiled, { age: 30 });
    expect(result).toMatchObject({
      simulation: true,
      persisted: false,
      outcome: 'APPROVED',
      trace: {
        nodes: ['START', 'APPROVE'],
        edges: ['START_APPROVE'],
        terminal: 'APPROVE',
      },
    });
  });

  it('rejects production before resolving any deployment', async () => {
    const { service, deployments } = setup();

    await expect(
      service.simulate(7n, 'CREDIT_POLICY', {
        requestId: 'simulation-request-2',
        environmentCode: 'PROD',
        variables: {},
      }),
    ).rejects.toMatchObject({ code: 'SIMULATION_PROD_FORBIDDEN', status: 403 });
    expect(deployments.resolve).not.toHaveBeenCalled();
  });

  it('does not execute the engine when variable validation fails', async () => {
    const { service, variables, engine } = setup();
    variables.resolve.mockResolvedValue({
      valid: false,
      values: {},
      errors: [{ code: 'REQUIRED', variable: 'age' }],
    });

    await expect(
      service.simulate(7n, 'CREDIT_POLICY', {
        requestId: 'simulation-request-3',
        environmentCode: 'SANDBOX',
        variables: {},
      }),
    ).resolves.toMatchObject({
      simulation: true,
      persisted: false,
      outcome: 'NO_DECISION',
      trace: { nodes: [], edges: [], terminal: null },
    });
    expect(engine.execute).not.toHaveBeenCalled();
  });
});
