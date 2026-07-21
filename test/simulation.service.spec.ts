import type { DeploymentResolverService } from '../src/modules/deployments/deployment-resolver.service';
import type { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import type { NestedTreeExecutionService } from '../src/modules/nested-trees/nested-tree-execution.service';
import { SimulationService } from '../src/modules/runtime/simulation.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import type { VariableResolutionService } from '../src/modules/variables/variable-resolution.service';

const principal = {
  id: 'user-1',
  tenantId: 7n,
  roles: ['RISK_ANALYST'],
  audience: 'management',
  requestId: 'req-1',
  authMethod: 'jwt',
} as unknown as AuthenticatedPrincipal;

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
        nestedExecutions: [],
      }),
    };
    const nestedTreeResolver = { resolve: jest.fn() };
    const nestedTrees = { bind: jest.fn().mockReturnValue(nestedTreeResolver) };
    const service = new SimulationService(
      deployments as unknown as DeploymentResolverService,
      variables as unknown as VariableResolutionService,
      engine as unknown as ExecutionEngineService,
      nestedTrees as unknown as NestedTreeExecutionService,
    );
    return { service, deployments, variables, engine, nestedTrees, nestedTreeResolver };
  }

  it('returns a deterministic trace without a persistence dependency', async () => {
    const { service, deployments, variables, engine, nestedTrees, nestedTreeResolver } = setup();

    const result = await service.simulate(
      7n,
      'CREDIT_POLICY',
      {
        requestId: 'simulation-request-1',
        environmentCode: 'sandbox',
        variables: { age: 30 },
      },
      principal,
    );

    expect(deployments.resolve).toHaveBeenCalledWith(7n, 'CREDIT_POLICY', 'SANDBOX');
    expect(variables.resolve).toHaveBeenCalledWith(
      [compiled.variables[0]],
      { age: 30 },
      expect.objectContaining({ allowExternal: false }),
    );
    expect(nestedTrees.bind).toHaveBeenCalledWith(7n, principal);
    expect(engine.execute).toHaveBeenCalledWith(compiled, { age: 30 }, nestedTreeResolver);
    expect(result).toMatchObject({
      simulation: true,
      persisted: false,
      outcome: 'APPROVED',
      trace: {
        nodes: ['START', 'APPROVE'],
        edges: ['START_APPROVE'],
        terminal: 'APPROVE',
        nested: [],
      },
    });
  });

  it('rejects production before resolving any deployment', async () => {
    const { service, deployments } = setup();

    await expect(
      service.simulate(
        7n,
        'CREDIT_POLICY',
        {
          requestId: 'simulation-request-2',
          environmentCode: 'PROD',
          variables: {},
        },
        principal,
      ),
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
      service.simulate(
        7n,
        'CREDIT_POLICY',
        {
          requestId: 'simulation-request-3',
          environmentCode: 'SANDBOX',
          variables: {},
        },
        principal,
      ),
    ).resolves.toMatchObject({
      simulation: true,
      persisted: false,
      outcome: 'NO_DECISION',
      trace: { nodes: [], edges: [], terminal: null },
    });
    expect(engine.execute).not.toHaveBeenCalled();
  });
});
