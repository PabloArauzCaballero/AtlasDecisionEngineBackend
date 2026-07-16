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
});
