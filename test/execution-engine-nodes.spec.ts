import { ConfigService } from '@nestjs/config';
import { ExecutionEngineService } from '../src/modules/graph/execution-engine.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';
import { compiledFixture } from './graph.fixture';
import type {
  CompiledDecisionArtifact,
  GraphActionSnapshot,
  GraphConditionSnapshot,
  GraphEdgeSnapshot,
  GraphNodeSnapshot,
  NodeType,
  VariableContractSnapshot,
} from '../src/modules/graph/graph.types';

/**
 * Node-type and action-type coverage for the execution engine — the code that walks a
 * compiled policy graph and produces the decision. Each terminal type, each action verb
 * and each fail-closed guard is exercised so a regression in the money path surfaces as a
 * failing test rather than a wrong decision in production.
 */
describe('ExecutionEngineService node and action coverage', () => {
  const engine = new ExecutionEngineService(
    new ExpressionEvaluator(),
    new ConfigService({ MAX_EXECUTION_STEPS: 32 }),
    new ScriptNodeRunnerService(new ConfigService({ SCRIPT_NODES_ENABLED: false })),
  );

  function node(
    key: string,
    type: NodeType,
    config: Record<string, unknown>,
    opts: Partial<GraphNodeSnapshot> = {},
  ): GraphNodeSnapshot {
    return {
      id: key,
      key,
      type,
      label: key,
      config,
      x: 0,
      y: 0,
      order: 1,
      terminal: opts.terminal ?? false,
      conditions: opts.conditions ?? [],
      actions: opts.actions ?? [],
    };
  }

  function edge(
    key: string,
    from: string,
    to: string,
    opts: Partial<GraphEdgeSnapshot> = {},
  ): GraphEdgeSnapshot {
    return {
      id: key,
      key,
      from,
      to,
      type: opts.type ?? 'DEFAULT',
      priority: opts.priority ?? 1,
      default: opts.default ?? true,
      conditions: opts.conditions ?? [],
    };
  }

  function outputVar(
    code: string,
    dataType: string,
    opts: Partial<VariableContractSnapshot> = {},
  ): VariableContractSnapshot {
    return {
      variableVersionId: `out-${code}`,
      usageType: 'OUTPUT',
      dependencyPath: `output.${code}`,
      code,
      version: 1,
      dataType,
      nullable: false,
      validationRules: [],
      sources: [],
      required: false,
      fallbackPolicy: 'FAIL_CLOSED',
      sensitive: false,
      ...opts,
    };
  }

  function action(
    code: string,
    type: string,
    payload: Record<string, unknown>,
    reasonCodes: GraphActionSnapshot['reasonCodes'] = [],
  ): GraphActionSnapshot {
    return { id: code, code, type, payload, terminal: false, reasonCodes };
  }

  function compile(opts: {
    nodes: GraphNodeSnapshot[];
    edges: GraphEdgeSnapshot[];
    variables?: VariableContractSnapshot[];
    actions?: GraphActionSnapshot[];
    conditions?: GraphConditionSnapshot[];
  }): CompiledDecisionArtifact {
    const g = compiledFixture();
    return {
      ...g,
      variables: opts.variables ?? [g.variables[0]],
      startNodeKey: 'START',
      nodes: Object.fromEntries(opts.nodes.map((n) => [n.key, n])),
      edgesByNode: Object.fromEntries(
        opts.nodes.map((n) => [
          n.key,
          opts.edges.filter((e) => e.from === n.key).sort((a, b) => a.priority - b.priority),
        ]),
      ),
      conditions: Object.fromEntries((opts.conditions ?? []).map((c) => [c.code, c])),
      actions: Object.fromEntries((opts.actions ?? []).map((a) => [a.code, a])),
    };
  }

  const scoreOk: GraphConditionSnapshot = {
    id: '20',
    code: 'SCORE_OK',
    name: 'Score acceptable',
    expressionType: 'JSON_AST',
    expression: { op: 'gte', left: { var: 'score' }, right: { value: 600 } },
    severity: 'BLOCKING',
    reusable: true,
  };

  describe('SCORE node', () => {
    it('sums base score, matched components and a points expression', async () => {
      const compiled = compile({
        nodes: [
          node('START', 'START', {}),
          node(
            'SCORE',
            'SCORE',
            {
              baseScore: 500,
              components: [
                { conditionCode: 'SCORE_OK', points: 100 },
                { points: 50 },
                { pointsExpression: { value: 25 } },
              ],
            },
            { terminal: true },
          ),
        ],
        edges: [edge('START_SCORE', 'START', 'SCORE')],
        conditions: [scoreOk],
      });

      const result = await engine.execute(compiled, { score: 700 });

      expect(result.score).toBe(675);
      expect(result.output.score).toBe(675);
    });

    it('lets an explicit score expression override the accumulated total', async () => {
      const compiled = compile({
        nodes: [
          node('START', 'START', {}),
          node(
            'SCORE',
            'SCORE',
            { baseScore: 10, scoreExpression: { value: 999 } },
            { terminal: true },
          ),
        ],
        edges: [edge('START_SCORE', 'START', 'SCORE')],
      });

      const result = await engine.execute(compiled, { score: 700 });
      expect(result.score).toBe(999);
    });
  });

  describe('terminal node types', () => {
    it('routes a MANUAL_REVIEW node into a queued review with rendered evidence', async () => {
      const compiled = compile({
        nodes: [
          node('START', 'START', {}),
          node('REVIEW', 'MANUAL_REVIEW', {
            queueCode: 'FRAUD_REVIEW',
            priority: 5,
            slaMinutes: 60,
            evidence: { note: 'inspect' },
          }),
        ],
        edges: [edge('START_REVIEW', 'START', 'REVIEW')],
      });

      const result = await engine.execute(compiled, { score: 700 });

      expect(result.outcome).toBe('MANUAL_REVIEW');
      expect(result.manualReview).toEqual({
        queueCode: 'FRAUD_REVIEW',
        priority: 5,
        slaMinutes: 60,
        evidence: { note: 'inspect' },
      });
      expect(result.terminalNodeKey).toBe('REVIEW');
    });

    it('adopts the configured outcome of an END node', async () => {
      const compiled = compile({
        nodes: [node('START', 'START', {}), node('END', 'END', { outcome: 'ESCALATED' })],
        edges: [edge('START_END', 'START', 'END')],
      });

      const result = await engine.execute(compiled, { score: 700 });
      expect(result.outcome).toBe('ESCALATED');
      expect(result.terminalNodeKey).toBe('END');
    });
  });

  describe('traversal guards', () => {
    it('throws when no outgoing edge matches and there is no default', async () => {
      const compiled = compile({
        nodes: [node('START', 'START', {}), node('END', 'END', { outcome: 'X' })],
        edges: [
          edge('START_END', 'START', 'END', {
            default: false,
            type: 'CONDITIONAL',
            conditions: [{ code: 'SCORE_OK', order: 1 }],
          }),
        ],
        conditions: [scoreOk],
      });

      await expect(engine.execute(compiled, { score: 100 })).rejects.toThrow('No outgoing edge');
    });

    it('throws when execution exceeds the step budget', async () => {
      const compiled = compile({
        nodes: [node('START', 'START', {})],
        edges: [edge('LOOP', 'START', 'START')],
      });

      await expect(engine.execute(compiled, { score: 1 })).rejects.toThrow('exceeded 32 steps');
    });

    it('throws when a branch leads nowhere without reaching a terminal', async () => {
      const compiled = compile({
        nodes: [node('START', 'START', {})],
        edges: [edge('DEAD', 'START', '')],
      });

      await expect(engine.execute(compiled, { score: 1 })).rejects.toThrow('without a terminal');
    });

    it('throws when an edge points at a node that is not compiled', async () => {
      const compiled = compile({
        nodes: [node('START', 'START', {})],
        edges: [edge('GHOST_EDGE', 'START', 'GHOST')],
      });

      await expect(engine.execute(compiled, { score: 1 })).rejects.toThrow('GHOST');
    });

    it('falls back to the default edge when a condition code is unknown', async () => {
      const compiled = compile({
        nodes: [
          node('START', 'START', {}),
          node('CHECK', 'CONDITION', {}),
          node('FALLBACK', 'END', { outcome: 'FELL_BACK' }),
          node('NEVER', 'END', { outcome: 'NEVER' }),
        ],
        edges: [
          edge('START_CHECK', 'START', 'CHECK'),
          edge('CHECK_NEVER', 'CHECK', 'NEVER', {
            default: false,
            type: 'CONDITIONAL',
            priority: 1,
            conditions: [{ code: 'MISSING', order: 1 }],
          }),
          edge('CHECK_FALLBACK', 'CHECK', 'FALLBACK', { default: true, priority: 999 }),
        ],
      });

      const result = await engine.execute(compiled, { score: 700 });
      expect(result.outcome).toBe('FELL_BACK');
    });
  });

  describe('RESULT node', () => {
    it('maps literal, variable, template and expression sources into declared outputs', async () => {
      const compiled = compile({
        variables: [
          outputVar('lit', 'STRING'),
          outputVar('fromVar', 'INTEGER'),
          outputVar('tmpl', 'STRING'),
          outputVar('expr', 'INTEGER'),
        ],
        nodes: [
          node('START', 'START', {}),
          node('RESULT', 'RESULT', {
            mode: 'MAPPING',
            assignments: [
              { outputCode: 'lit', source: 'LITERAL', value: 'hello' },
              { outputCode: 'fromVar', source: 'VARIABLE', variablePath: 'score' },
              { outputCode: 'tmpl', source: 'TEMPLATE', value: 'plain' },
              {
                outputCode: 'expr',
                source: 'EXPRESSION',
                expression: { op: 'add', args: [{ var: 'score' }, { value: 1 }] },
              },
            ],
          }),
        ],
        edges: [edge('START_RESULT', 'START', 'RESULT')],
      });

      const result = await engine.execute(compiled, { score: 700 });

      expect(result.output).toMatchObject({ lit: 'hello', fromVar: 700, tmpl: 'plain', expr: 701 });
    });

    it('rejects a RESULT that writes an undeclared output', async () => {
      const compiled = compile({
        variables: [outputVar('declared', 'STRING')],
        nodes: [
          node('START', 'START', {}),
          node('RESULT', 'RESULT', {
            mode: 'MAPPING',
            assignments: [{ outputCode: 'ghost', source: 'LITERAL', value: 'x' }],
          }),
        ],
        edges: [edge('START_RESULT', 'START', 'RESULT')],
      });

      await expect(engine.execute(compiled, { score: 1 })).rejects.toThrow(
        'undeclared output ghost',
      );
    });

    it('rejects an invalid RESULT mode and an unsupported script language', async () => {
      const bad = compile({
        nodes: [node('START', 'START', {}), node('RESULT', 'RESULT', { mode: 'WEIRD' })],
        edges: [edge('START_RESULT', 'START', 'RESULT')],
      });
      await expect(engine.execute(bad, { score: 1 })).rejects.toThrow('Unsupported RESULT mode');

      const badScript = compile({
        nodes: [
          node('START', 'START', {}),
          node('RESULT', 'RESULT', { mode: 'SCRIPT', script: { language: 'RUBY', source: '1' } }),
        ],
        edges: [edge('START_RESULT', 'START', 'RESULT')],
      });
      await expect(engine.execute(badScript, { score: 1 })).rejects.toThrow(
        'RESULT script language',
      );
    });

    it('enforces output types, nullability and primary-output length', async () => {
      const typeMismatch = compile({
        variables: [outputVar('num', 'INTEGER')],
        nodes: [
          node('START', 'START', {}),
          node('RESULT', 'RESULT', {
            mode: 'MAPPING',
            assignments: [{ outputCode: 'num', source: 'LITERAL', value: 'not-a-number' }],
          }),
        ],
        edges: [edge('START_RESULT', 'START', 'RESULT')],
      });
      await expect(engine.execute(typeMismatch, { score: 1 })).rejects.toThrow('must match');

      const nullNonNullable = compile({
        variables: [outputVar('must', 'STRING', { required: true })],
        nodes: [
          node('START', 'START', {}),
          node('RESULT', 'RESULT', {
            mode: 'MAPPING',
            assignments: [{ outputCode: 'must', source: 'LITERAL', value: null }],
          }),
        ],
        edges: [edge('START_RESULT', 'START', 'RESULT')],
      });
      await expect(engine.execute(nullNonNullable, { score: 1 })).rejects.toThrow('cannot be null');

      const nullableOk = compile({
        variables: [outputVar('maybe', 'STRING', { nullable: true })],
        nodes: [
          node('START', 'START', {}),
          node('RESULT', 'RESULT', {
            mode: 'MAPPING',
            assignments: [{ outputCode: 'maybe', source: 'LITERAL', value: null }],
          }),
        ],
        edges: [edge('START_RESULT', 'START', 'RESULT')],
      });
      const okResult = await engine.execute(nullableOk, { score: 1 });
      expect(okResult.output.maybe).toBeNull();

      const tooLong = compile({
        variables: [outputVar('big', 'STRING', { usageType: 'OUTPUT_PRIMARY' })],
        nodes: [
          node('START', 'START', {}),
          node('RESULT', 'RESULT', {
            mode: 'MAPPING',
            assignments: [{ outputCode: 'big', source: 'LITERAL', value: 'x'.repeat(81) }],
          }),
        ],
        edges: [edge('START_RESULT', 'START', 'RESULT')],
      });
      await expect(engine.execute(tooLong, { score: 1 })).rejects.toThrow('exceeds 80');
    });

    it('applies a declared default for an output the graph never wrote', async () => {
      const compiled = compile({
        variables: [outputVar('grade', 'STRING', { defaultValue: 'B', required: true })],
        nodes: [node('START', 'START', {}), node('END', 'END', { outcome: 'DONE' })],
        edges: [edge('START_END', 'START', 'END')],
      });

      const result = await engine.execute(compiled, { score: 1 });
      expect(result.output.grade).toBe('B');
    });
  });

  describe('ACTION node', () => {
    it('applies every scalar mutation verb in order', async () => {
      const compiled = compile({
        nodes: [
          node('START', 'START', {}),
          node(
            'ACT',
            'ACTION',
            {},
            {
              terminal: true,
              actions: [
                { code: 'A_SCORE', order: 1 },
                { code: 'A_ADD', order: 2 },
                { code: 'A_LIMIT', order: 3 },
                { code: 'A_BAND', order: 4 },
                { code: 'A_FIELD', order: 5 },
              ],
            },
          ),
        ],
        edges: [edge('START_ACT', 'START', 'ACT')],
        actions: [
          action('A_SCORE', 'SET_SCORE', { valueExpression: { value: 42 } }),
          action('A_ADD', 'ADD_SCORE', { valueExpression: { value: 8 } }),
          action('A_LIMIT', 'SET_LIMIT', { valueExpression: { value: 1000 } }),
          action('A_BAND', 'SET_RISK_BAND', { valueExpression: { value: 'A' } }),
          action('A_FIELD', 'SET_FIELD', { field: 'flag', valueExpression: { value: 'on' } }),
        ],
      });

      const result = await engine.execute(compiled, { score: 700 });

      expect(result.score).toBe(50);
      expect(result.limit).toBe(1000);
      expect(result.riskBand).toBe('A');
      expect(result.output.flag).toBe('on');
    });

    it('creates a manual review from an action and emits sorted reasons', async () => {
      const compiled = compile({
        nodes: [
          node('START', 'START', {}),
          node(
            'ACT',
            'ACTION',
            {},
            {
              terminal: true,
              actions: [
                { code: 'A_REVIEW', order: 1 },
                { code: 'A_REASONS', order: 2 },
              ],
            },
          ),
        ],
        edges: [edge('START_ACT', 'START', 'ACT')],
        actions: [
          action('A_REVIEW', 'CREATE_MANUAL_REVIEW', {
            queueCode: 'RISK',
            priority: 3,
            slaMinutes: 30,
          }),
          action('A_REASONS', 'EMIT_REASON', {}, [
            {
              id: '1',
              code: 'BBB',
              category: 'C',
              publicMessage: 'b',
              internalMessage: 'b',
              severity: 'LOW',
              adverseAction: false,
              priority: 10,
            },
            {
              id: '2',
              code: 'CCC',
              category: 'C',
              publicMessage: 'c',
              internalMessage: 'c',
              severity: 'LOW',
              adverseAction: false,
              priority: 5,
            },
            {
              id: '3',
              code: 'AAA',
              category: 'C',
              publicMessage: 'a',
              internalMessage: 'a',
              severity: 'LOW',
              adverseAction: false,
              priority: 10,
            },
          ]),
        ],
      });

      const result = await engine.execute(compiled, { score: 700 });

      expect(result.outcome).toBe('MANUAL_REVIEW');
      expect(result.manualReview?.queueCode).toBe('RISK');
      // priority ascending, then code ascending on ties.
      expect(result.reasons.map((r) => r.code)).toEqual(['CCC', 'AAA', 'BBB']);
    });

    it('rejects an unsupported action type and a missing action reference', async () => {
      const badType = compile({
        nodes: [
          node('START', 'START', {}),
          node('ACT', 'ACTION', {}, { terminal: true, actions: [{ code: 'A_BAD', order: 1 }] }),
        ],
        edges: [edge('START_ACT', 'START', 'ACT')],
        actions: [action('A_BAD', 'FROBNICATE', {})],
      });
      await expect(engine.execute(badType, { score: 1 })).rejects.toThrow(
        'Unsupported action type',
      );

      const missing = compile({
        nodes: [
          node('START', 'START', {}),
          node('ACT', 'ACTION', {}, { terminal: true, actions: [{ code: 'GONE', order: 1 }] }),
        ],
        edges: [edge('START_ACT', 'START', 'ACT')],
      });
      await expect(engine.execute(missing, { score: 1 })).rejects.toThrow('Action GONE not found');
    });
  });

  describe('edge and action value resolution', () => {
    it('resolves an action value from a template and yields undefined for an empty payload', async () => {
      const compiled = compile({
        nodes: [
          node('START', 'START', {}),
          node(
            'ACT',
            'ACTION',
            {},
            {
              terminal: true,
              actions: [
                { code: 'A_LIMIT', order: 1 },
                { code: 'A_BAND', order: 2 },
              ],
            },
          ),
        ],
        edges: [edge('START_ACT', 'START', 'ACT')],
        actions: [
          action('A_LIMIT', 'SET_LIMIT', { value: '500' }),
          action('A_BAND', 'SET_RISK_BAND', {}),
        ],
      });

      const result = await engine.execute(compiled, { score: 1 });
      expect(result.limit).toBe(500);
      expect(result.riskBand).toBe('undefined');
    });

    it('sorts a multi-condition edge before evaluating it', async () => {
      const compiled = compile({
        nodes: [
          node('START', 'START', {}),
          node('CHECK', 'CONDITION', {}),
          node('YES', 'END', { outcome: 'MATCHED' }),
          node('NO', 'END', { outcome: 'DEFAULT' }),
        ],
        edges: [
          edge('START_CHECK', 'START', 'CHECK'),
          edge('CHECK_YES', 'CHECK', 'YES', {
            default: false,
            type: 'CONDITIONAL',
            priority: 1,
            conditions: [
              { code: 'SCORE_OK', order: 2 },
              { code: 'SCORE_OK', order: 1 },
            ],
          }),
          edge('CHECK_NO', 'CHECK', 'NO', { default: true, priority: 999 }),
        ],
        conditions: [scoreOk],
      });

      const result = await engine.execute(compiled, { score: 700 });
      expect(result.outcome).toBe('MATCHED');
    });
  });

  describe('default configuration fallbacks', () => {
    it('uses default review parameters when a MANUAL_REVIEW node omits config', async () => {
      const compiled = compile({
        nodes: [node('START', 'START', {}), node('REVIEW', 'MANUAL_REVIEW', {})],
        edges: [edge('START_REVIEW', 'START', 'REVIEW')],
      });

      const result = await engine.execute(compiled, { score: 1 });
      expect(result.manualReview).toEqual({
        queueCode: 'CREDIT_REVIEW',
        priority: 100,
        slaMinutes: 240,
        evidence: {},
      });
    });

    it('falls back to NO_DECISION for a bare END node and an empty SET_OUTCOME', async () => {
      const endOnly = compile({
        nodes: [node('START', 'START', {}), node('END', 'END', {})],
        edges: [edge('START_END', 'START', 'END')],
      });
      expect((await engine.execute(endOnly, { score: 1 })).outcome).toBe('NO_DECISION');

      const setOutcome = compile({
        nodes: [
          node('START', 'START', {}),
          node('ACT', 'ACTION', {}, { terminal: true, actions: [{ code: 'A', order: 1 }] }),
        ],
        edges: [edge('START_ACT', 'START', 'ACT')],
        actions: [action('A', 'SET_OUTCOME', {})],
      });
      expect((await engine.execute(setOutcome, { score: 1 })).outcome).toBe('NO_DECISION');
    });

    it('treats a score component without points as zero', async () => {
      const compiled = compile({
        nodes: [
          node('START', 'START', {}),
          node('SCORE', 'SCORE', { baseScore: 100, components: [{}] }, { terminal: true }),
        ],
        edges: [edge('START_SCORE', 'START', 'SCORE')],
      });

      const result = await engine.execute(compiled, { score: 700 });
      expect(result.score).toBe(100);
    });
  });

  describe('output typing and assignment shapes', () => {
    it('accepts each declared data type and maps the legacy score/riskBand/limit codes', async () => {
      const compiled = compile({
        variables: [
          outputVar('b', 'BOOLEAN'),
          outputVar('o', 'OBJECT'),
          outputVar('a', 'ARRAY'),
          outputVar('d', 'DECIMAL'),
          outputVar('dt', 'DATE'),
          outputVar('score', 'INTEGER'),
          outputVar('riskBand', 'STRING'),
          outputVar('limit', 'INTEGER'),
        ],
        nodes: [
          node('START', 'START', {}),
          node('RESULT', 'RESULT', {
            mode: 'MAPPING',
            assignments: [
              { outputCode: 'b', source: 'LITERAL', value: true },
              { outputCode: 'o', source: 'LITERAL', value: { k: 1 } },
              { outputCode: 'a', source: 'LITERAL', value: [1, 2] },
              { outputCode: 'd', source: 'LITERAL', value: 12.5 },
              { outputCode: 'dt', source: 'LITERAL', value: '2026-01-01' },
              { outputCode: 'score', source: 'LITERAL', value: 640 },
              { outputCode: 'riskBand', source: 'LITERAL', value: 'B' },
              { outputCode: 'limit', source: 'LITERAL', value: 5000 },
            ],
          }),
        ],
        edges: [edge('START_RESULT', 'START', 'RESULT')],
      });

      const result = await engine.execute(compiled, { score: 1 });

      expect(result.output).toMatchObject({
        b: true,
        o: { k: 1 },
        a: [1, 2],
        d: 12.5,
        dt: '2026-01-01',
      });
      expect(result.score).toBe(640);
      expect(result.riskBand).toBe('B');
      expect(result.limit).toBe(5000);
    });

    it('resolves assignments via target/path/valueExpression and defaults to MAPPING mode', async () => {
      const compiled = compile({
        variables: [outputVar('viaTarget', 'INTEGER'), outputVar('viaPath', 'INTEGER')],
        nodes: [
          node('START', 'START', {}),
          // No mode key: the engine must default to MAPPING. Each assignment uses the
          // alternate field name (target/valueExpression/path) rather than the primary.
          node('RESULT', 'RESULT', {
            assignments: [
              { target: 'viaTarget', source: 'EXPRESSION', valueExpression: { value: 7 } },
              { target: 'viaPath', source: 'VARIABLE', path: 'score' },
            ],
          }),
        ],
        edges: [edge('START_RESULT', 'START', 'RESULT')],
      });

      const result = await engine.execute(compiled, { score: 55 });
      expect(result.output).toMatchObject({ viaTarget: 7, viaPath: 55 });
    });
  });
});
