import type { DeploymentResolverService } from '../src/modules/deployments/deployment-resolver.service';
import type { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import type { NestedTreeExecutionService } from '../src/modules/nested-trees/nested-tree-execution.service';
import type { WorkerServiceInvokerService } from '../src/modules/workers/worker-service-invoker.service';
import { SimulationService } from '../src/modules/runtime/simulation.service';
import type { AuthenticatedPrincipal } from '../src/common/security/security.types';
import type { VariableResolutionService } from '../src/modules/variables/variable-resolution.service';
import { MetricsService } from '../src/common/observability/metrics.service';

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
    environmentCode: 'DEV',
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
    const workerServiceInvoker = { invoke: jest.fn() };
    const workerServices = { bind: jest.fn().mockReturnValue(workerServiceInvoker) };
    const metrics = new MetricsService();
    const service = new SimulationService(
      deployments as unknown as DeploymentResolverService,
      variables as unknown as VariableResolutionService,
      engine as unknown as ExecutionEngineService,
      nestedTrees as unknown as NestedTreeExecutionService,
      workerServices as unknown as WorkerServiceInvokerService,
      metrics,
    );
    return {
      service,
      deployments,
      variables,
      engine,
      nestedTrees,
      nestedTreeResolver,
      workerServiceInvoker,
      metrics,
    };
  }

  it('returns a deterministic trace without a persistence dependency', async () => {
    const {
      service,
      deployments,
      variables,
      engine,
      nestedTrees,
      nestedTreeResolver,
      workerServiceInvoker,
    } = setup();

    const result = await service.simulate(
      7n,
      'CREDIT_POLICY',
      {
        requestId: 'simulation-request-1',
        environmentCode: 'dev',
        variables: { age: 30 },
      },
      principal,
    );

    expect(deployments.resolve).toHaveBeenCalledWith(7n, 'CREDIT_POLICY', 'DEV');
    expect(variables.resolve).toHaveBeenCalledWith(
      [compiled.variables[0]],
      { age: 30 },
      expect.objectContaining({ allowExternal: false }),
    );
    expect(nestedTrees.bind).toHaveBeenCalledWith(7n, principal);
    expect(engine.execute).toHaveBeenCalledWith(
      compiled,
      { age: 30 },
      nestedTreeResolver,
      undefined,
      undefined,
      // El invocador de servicios de worker viaja como sexto argumento de llamada, igual
      // que el resolutor de árboles anidados: la simulación tiene que ejercitar los nodos
      // `WORKER` con el mismo cableado que la ejecución real.
      workerServiceInvoker,
    );
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
          environmentCode: 'DEV',
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

  /**
   * §12 pide `atlas_dev_prod_result_diff_total`, y el punto delicado era la semántica: «dos
   * ejecuciones equivalentes entre ambientes» solo está bien definido si se fija todo menos
   * el ambiente. Por eso la comparación reutiliza los valores YA resueltos en vez de
   * resolverlos otra vez — si cada lado resolviera los suyos, una diferencia podría venir de
   * un valor por defecto o de un proveedor externo y la métrica dejaría de medir lo que dice
   * medir. Fijadas las entradas, lo único que varía es el artefacto compilado que cada
   * ambiente tiene desplegado, que es la desviación que interesa.
   */
  describe('comparación con producción (§12)', () => {
    const simulate = (compareWithProduction?: boolean) => ({
      requestId: 'simulation-request-cmp',
      environmentCode: 'DEV',
      variables: { age: 30 },
      ...(compareWithProduction === undefined ? {} : { compareWithProduction }),
    });

    it('no compara ni ejecuta de más si no se pide', async () => {
      const { service, engine, deployments } = setup();
      const result = await service.simulate(7n, 'CREDIT_POLICY', simulate(), principal);
      expect(result.productionComparison).toBeUndefined();
      expect(engine.execute).toHaveBeenCalledTimes(1);
      expect(deployments.resolve).toHaveBeenCalledTimes(1);
    });

    it('ejecuta PROD con las MISMAS entradas ya resueltas', async () => {
      const { service, engine, variables } = setup();
      await service.simulate(7n, 'CREDIT_POLICY', simulate(true), principal);

      expect(engine.execute).toHaveBeenCalledTimes(2);
      // Las variables se resuelven UNA sola vez y las dos pasadas reciben ese mismo objeto.
      expect(variables.resolve).toHaveBeenCalledTimes(1);
      expect(engine.execute.mock.calls[0][1]).toBe(engine.execute.mock.calls[1][1]);
    });

    it('no marca divergencia cuando PROD decide lo mismo', async () => {
      const { service } = setup();
      const result = await service.simulate(7n, 'CREDIT_POLICY', simulate(true), principal);
      expect(result.productionComparison).toMatchObject({
        compared: true,
        differs: false,
        differences: [],
      });
    });

    it('detalla en qué se separan resultado, salida y razones', async () => {
      const { service, engine } = setup();
      engine.execute.mockResolvedValueOnce({
        status: 'SUCCESS',
        outcome: 'APPROVED',
        output: { decision: 'APPROVED' },
        reasons: [],
        visitedNodeKeys: [],
        traversedEdgeKeys: [],
        terminalNodeKey: 'A',
        nestedExecutions: [],
      });
      engine.execute.mockResolvedValueOnce({
        status: 'SUCCESS',
        outcome: 'DECLINED',
        output: { decision: 'DECLINED' },
        reasons: [{ code: 'LOW_SCORE' }],
        visitedNodeKeys: [],
        traversedEdgeKeys: [],
        terminalNodeKey: 'D',
        nestedExecutions: [],
      });

      const result = await service.simulate(7n, 'CREDIT_POLICY', simulate(true), principal);
      expect(result.productionComparison).toMatchObject({
        compared: true,
        differs: true,
        differences: ['OUTCOME', 'OUTPUT', 'REASON_CODES'],
        production: { outcome: 'DECLINED', reasonCodes: ['LOW_SCORE'] },
      });
    });

    it('que PROD no esté desplegado no tumba la simulación', async () => {
      // Lo contrario dejaría la herramienta inservible justo en el artefacto que todavía no
      // ha salido a producción, que es cuando más se simula.
      const { service, deployments } = setup();
      deployments.resolve.mockImplementation((_tenant: bigint, _code: string, env: string) =>
        env === 'PROD'
          ? Promise.reject(new Error('no active deployment'))
          : Promise.resolve(deployment),
      );

      const result = await service.simulate(7n, 'CREDIT_POLICY', simulate(true), principal);
      expect(result.outcome).toBe('APPROVED');
      expect(result.productionComparison).toEqual({
        compared: false,
        reason: 'PRODUCTION_NOT_DEPLOYED',
      });
    });

    it('publica la métrica con el tipo de diferencia', async () => {
      const { service, metrics } = setup();
      await service.simulate(7n, 'CREDIT_POLICY', simulate(true), principal);
      const rendered = await metrics.renderPrometheus();
      expect(rendered).toContain('atlas_dev_prod_result_diff_total');
      // Contar las coincidencias es lo que da denominador a la tasa de divergencia.
      expect(rendered).toMatch(/atlas_dev_prod_result_diff_total\{[^}]*difference="NONE"[^}]*\} 1/);
    });
  });
});
