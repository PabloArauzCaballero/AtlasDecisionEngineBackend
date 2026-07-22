import { ViewsService } from '../src/modules/views/views.service';
import { ArtifactGraphWriterService } from '../src/modules/artifacts/artifact-graph-writer.service';

describe('read model views', () => {
  it('filters the input contract to the latest version of the artifact', async () => {
    const rows = [
      { versionId: 9n, versionNumber: 3, variableCode: 'income', usageType: 'INPUT' },
      { versionId: 9n, versionNumber: 3, variableCode: 'scoring', usageType: 'OUTPUT_PRIMARY' },
      { versionId: 4n, versionNumber: 1, variableCode: 'legacy', usageType: 'INPUT' },
    ];
    const service = new ViewsService({ $queryRaw: jest.fn().mockResolvedValue(rows) } as never);

    const contract = await service.artifactInputContract(7n, { artifactCode: 'CREDIT-RISK' });

    expect(contract.versionId).toBe(9n);
    expect(contract.versionNumber).toBe(3);
    expect(contract.variables.map((row) => row.variableCode)).toEqual(['income', 'scoring']);
  });

  it('wraps global search matches with the query echo and total', async () => {
    const items = [
      {
        entityType: 'ARTIFACT',
        entityId: 1n,
        code: 'CREDIT-RISK',
        title: 'Credit',
        subtitle: null,
        occurredAt: null,
      },
    ];
    const service = new ViewsService({ $queryRaw: jest.fn().mockResolvedValue(items) } as never);

    await expect(service.globalSearch(7n, { q: 'cred' })).resolves.toEqual({
      query: 'cred',
      total: 1,
      items,
    });
  });

  it('persists RESULT script nodes into the script registry on graph replace', async () => {
    const scriptCreateMany = jest.fn();
    const scriptDeleteMany = jest.fn();
    const tx = {
      decisionArtifactVersion: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 5n, status: 'DRAFT', lockVersion: 2, canonicalChecksum: null }),
      },
      // The writer batches inserts with createManyAndReturn and maps generated ids back by
      // business key, so each double must resolve to the {id, <businessKey>} projection it
      // selects — not a single row. Join tables are inserted as a second createMany batch.
      decisionRuleEdge: {
        deleteMany: jest.fn(),
        createManyAndReturn: jest.fn().mockResolvedValue([]),
      },
      decisionRuleNode: {
        deleteMany: jest.fn(),
        createManyAndReturn: jest.fn().mockResolvedValue([{ id: 1n, nodeKey: 'RESULT_1' }]),
      },
      decisionRuleCondition: {
        deleteMany: jest.fn(),
        createManyAndReturn: jest.fn().mockResolvedValue([]),
      },
      decisionRuleAction: {
        deleteMany: jest.fn(),
        createManyAndReturn: jest.fn().mockResolvedValue([]),
      },
      decisionReasonCode: { count: jest.fn().mockResolvedValue(0) },
      decisionActionReasonMapping: { createMany: jest.fn() },
      decisionNodeCondition: { createMany: jest.fn() },
      decisionNodeAction: { createMany: jest.fn() },
      decisionEdgeCondition: { createMany: jest.fn() },
      decisionArtifactVariableDependency: { deleteMany: jest.fn(), createMany: jest.fn() },
      decisionCompiledArtifact: { deleteMany: jest.fn() },
      decisionNodeScript: { deleteMany: scriptDeleteMany, createMany: scriptCreateMany },
      decisionVariableVersion: { findMany: jest.fn().mockResolvedValue([{ id: 11n }]) },
      decisionChangeLog: { create: jest.fn() },
    };
    const prisma = {
      decisionArtifactVersion: {
        findFirst: jest.fn().mockResolvedValue({ id: 5n, status: 'DRAFT', lockVersion: 1 }),
      },
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { append: jest.fn() };
    const service = new ArtifactGraphWriterService(prisma as never, audit as never);

    await service.replaceDraftGraph(
      7n,
      5n,
      1,
      {
        dependencies: [
          {
            variableVersionId: '11',
            usageType: 'INPUT',
            isRequired: true,
            fallbackPolicy: 'FAIL_CLOSED',
            dependencyPath: 'input.income',
          },
        ],
        conditions: [],
        actions: [],
        nodes: [
          {
            key: 'RESULT_1',
            type: 'RESULT',
            label: 'Resultado',
            config: {
              mode: 'SCRIPT',
              script: { language: 'PYTHON', source: 'result = {"scoring": variables["income"]}' },
            },
            x: 0,
            y: 0,
            order: 1,
            terminal: true,
            conditions: [],
            actions: [],
          },
        ],
        edges: [],
      } as never,
      { id: 'analyst-1', requestId: 'req-1' } as never,
    );

    expect(scriptDeleteMany).toHaveBeenCalledWith({ where: { artifactVersionId: 5n } });
    expect(scriptCreateMany).toHaveBeenCalledTimes(1);
    const [{ data }] = scriptCreateMany.mock.calls[0] as [{ data: Array<Record<string, unknown>> }];
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      tenantId: 7n,
      artifactVersionId: 5n,
      nodeKey: 'RESULT_1',
      language: 'PYTHON',
      inputVariablesJson: ['input.income'],
      outputVariablesJson: [],
      createdBy: 'analyst-1',
    });
    expect(String(data[0].sourceChecksum)).toMatch(/^[0-9a-f]{64}$/);
  });
});
