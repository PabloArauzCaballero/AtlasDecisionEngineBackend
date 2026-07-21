import { ConfigService } from '@nestjs/config';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import { compiledFixture } from './graph.fixture';
import type { CompiledDecisionArtifact } from '../src/modules/graph/graph.types';

describe('ExecutionEngineService', () => {
  const engine = new ExecutionEngineService(
    new ExpressionEvaluator(),
    new ConfigService({ MAX_EXECUTION_STEPS: 32 }),
    new ScriptNodeRunnerService(new ConfigService({ SCRIPT_NODES_ENABLED: false })),
  );

  it('approves when the conditional edge matches', async () => {
    const result = await engine.execute(compiledFixture(), { score: 700 });
    expect(result.outcome).toBe('APPROVED');
    expect(result.reasons.map((reason) => reason.code)).toEqual(['APPROVED_POLICY']);
    expect(result.visitedNodeKeys).toEqual(['START', 'CHECK', 'APPROVED']);
    expect(result.traversedEdgeKeys).toEqual(['START_CHECK', 'CHECK_APPROVE']);
  });

  it('uses the explicit default edge when conditions do not match', async () => {
    const result = await engine.execute(compiledFixture(), { score: 500 });
    expect(result.outcome).toBe('DECLINED');
    expect(result.reasons[0].adverseAction).toBe(true);
    expect(result.terminalNodeKey).toBe('DECLINED');
  });

  it('returns identical business output for the same input', async () => {
    const first = await engine.execute(compiledFixture(), { score: 700 });
    const second = await engine.execute(compiledFixture(), { score: 700 });
    expect({ ...first, trace: undefined }).toEqual({ ...second, trace: undefined });
  });

  it('produces a typed configurable primary output with visual mappings', async () => {
    const compiled = compiledFixture();
    compiled.runtimeSchemaVersion = '1.1';
    compiled.variables.push({
      variableVersionId: '11',
      usageType: 'OUTPUT_PRIMARY',
      dependencyPath: 'output.scoring',
      code: 'scoring',
      version: 1,
      dataType: 'INTEGER',
      nullable: false,
      validationRules: [],
      sources: [],
      required: true,
      fallbackPolicy: 'FAIL_CLOSED',
      sensitive: false,
    });
    compiled.nodes = {
      START: compiled.nodes.START,
      RESULT: {
        id: '5',
        key: 'RESULT',
        type: 'RESULT',
        label: 'Scoring result',
        config: {
          mode: 'MAPPING',
          assignments: [
            {
              outputCode: 'scoring',
              source: 'EXPRESSION',
              expression: { op: 'sub', args: [{ var: 'score' }, { value: 700 }] },
            },
          ],
        },
        x: 100,
        y: 0,
        order: 2,
        terminal: true,
        conditions: [],
        actions: [],
      },
    };
    compiled.edgesByNode = {
      START: [{ key: 'START_RESULT', from: 'START', to: 'RESULT', type: 'DEFAULT', priority: 1, default: true, conditions: [] }],
      RESULT: [],
    };

    const result = await engine.execute(compiled as CompiledDecisionArtifact, { score: 700 });

    expect(result.status).toBe('SUCCEEDED');
    expect(result.primaryResult).toEqual({ code: 'scoring', value: 0 });
    expect(result.output.scoring).toBe(0);
    expect(result.outcome).toBe('0');
  });

  it('fails closed when a required configured output is missing', async () => {
    const compiled = compiledFixture();
    compiled.variables.push({
      variableVersionId: '11', usageType: 'OUTPUT_PRIMARY', dependencyPath: 'output.scoring',
      code: 'scoring', version: 1, dataType: 'INTEGER', nullable: false,
      validationRules: [], sources: [], required: true, fallbackPolicy: 'FAIL_CLOSED', sensitive: false,
    });
    await expect(engine.execute(compiled, { score: 700 })).rejects.toThrow('required output scoring');
  });

  describe('onStep live progress (Fase 8)', () => {
    it('reports RUNNING then COMPLETED for each visited node, with the discarded edge on a branch', async () => {
      const events: unknown[] = [];
      await engine.execute(compiledFixture(), { score: 700 }, undefined, undefined, (event) => events.push(event));

      expect(events).toEqual([
        { status: 'RUNNING', nodeKey: 'START', nodeType: 'START' },
        expect.objectContaining({ status: 'COMPLETED', nodeKey: 'START', branchTaken: 'START_CHECK' }),
        { status: 'RUNNING', nodeKey: 'CHECK', nodeType: 'CONDITION' },
        expect.objectContaining({
          status: 'COMPLETED',
          nodeKey: 'CHECK',
          branchTaken: 'CHECK_APPROVE',
          discardedEdgeKeys: ['CHECK_DECLINE'],
        }),
        { status: 'RUNNING', nodeKey: 'APPROVED', nodeType: 'ACTION' },
        expect.objectContaining({ status: 'COMPLETED', nodeKey: 'APPROVED' }),
      ]);
    });

    it('emits an ERROR event for the failing node before rethrowing', async () => {
      const compiled = compiledFixture();
      compiled.edgesByNode.CHECK = [];
      const events: unknown[] = [];

      await expect(
        engine.execute(compiled, { score: 700 }, undefined, undefined, (event) => events.push(event)),
      ).rejects.toThrow(/No outgoing edge matched/);
      expect(events).toEqual([
        { status: 'RUNNING', nodeKey: 'START', nodeType: 'START' },
        expect.objectContaining({ status: 'COMPLETED', nodeKey: 'START' }),
        { status: 'RUNNING', nodeKey: 'CHECK', nodeType: 'CONDITION' },
        expect.objectContaining({ status: 'ERROR', nodeKey: 'CHECK' }),
      ]);
    });
  });

  describe('nested artifact references (Fase 7)', () => {
    function referenceCompiled() {
      const compiled = compiledFixture();
      compiled.variables.push({
        variableVersionId: '11', usageType: 'OUTPUT_PRIMARY', dependencyPath: 'output.riskLevel',
        code: 'riskLevel', version: 1, dataType: 'STRING', nullable: false,
        validationRules: [], sources: [], required: true, fallbackPolicy: 'FAIL_CLOSED', sensitive: false,
      });
      compiled.nodes = {
        START: compiled.nodes.START,
        NESTED_CHECK: {
          id: '5',
          key: 'NESTED_CHECK',
          type: 'RESULT',
          label: 'Nested reference',
          config: {
            mode: 'REFERENCE',
            outputAssignments: [{ outputCode: 'riskLevel', childOutputCode: 'level' }],
          },
          x: 100,
          y: 0,
          order: 2,
          terminal: true,
          conditions: [],
          actions: [],
        },
      };
      compiled.edgesByNode = {
        START: [{ key: 'START_RESULT', from: 'START', to: 'NESTED_CHECK', type: 'DEFAULT', priority: 1, default: true, conditions: [] }],
        NESTED_CHECK: [],
      };
      return compiled as unknown as CompiledDecisionArtifact;
    }

    it('fails closed with NESTED_REFERENCE_NOT_CONFIGURED when no resolver is supplied', async () => {
      await expect(engine.execute(referenceCompiled(), { score: 700 })).rejects.toMatchObject({
        code: 'NESTED_REFERENCE_NOT_CONFIGURED',
      });
    });

    it('invokes the resolver, maps its output, and records a nested trace entry', async () => {
      const resolver = {
        resolve: jest.fn().mockResolvedValue({
          output: { level: 'HIGH' },
          trace: [
            {
              sequence: 1,
              parentSequence: null,
              depth: 1,
              nodeKey: 'NESTED_CHECK',
              childArtifactVersionId: '99',
              status: 'SUCCEEDED',
              durationMs: 5,
              output: { level: 'HIGH' },
            },
          ],
        }),
      };
      const compiled = referenceCompiled();
      const result = await engine.execute(compiled, { score: 700 }, resolver);

      expect(resolver.resolve).toHaveBeenCalledWith(
        compiled.version.id,
        'NESTED_CHECK',
        expect.any(Object),
        { sequence: { value: 0 }, parentSequence: null, depth: 1 },
      );
      expect(result.output.riskLevel).toBe('HIGH');
      expect(result.nestedExecutions).toEqual([
        expect.objectContaining({ nodeKey: 'NESTED_CHECK', status: 'SUCCEEDED', childArtifactVersionId: '99' }),
      ]);
    });
  });
});
