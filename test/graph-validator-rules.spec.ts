import { ConfigService } from '@nestjs/config';
import { HashService } from '../src/common/crypto/hash.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { GraphValidatorService } from '../src/modules/graph/graph-validator.service';
import { graphSnapshot } from './graph.fixture';
import type {
  ArtifactGraphSnapshot,
  GraphNodeSnapshot,
  VariableContractSnapshot,
} from '../src/modules/graph/graph.types';

/**
 * Rule-by-rule coverage of the pre-compilation graph validator. Every guard here is a
 * reason a policy is refused before it can decide money, so each error/warning code is
 * provoked with a minimal, targeted mutation of a known-valid graph.
 */
describe('GraphValidatorService rules', () => {
  const hash = new HashService(
    new ConfigService({ AUDIT_HASH_SECRET: 'test-secret-that-is-long-enough' }),
  );
  const validator = new GraphValidatorService(new ExpressionEvaluator(), hash);

  function run(mutate: (g: ArtifactGraphSnapshot) => void) {
    const g = graphSnapshot();
    mutate(g);
    return validator.validate(g);
  }
  const errors = (mutate: (g: ArtifactGraphSnapshot) => void): string[] =>
    run(mutate).errors.map((e) => e.code);
  const warnings = (mutate: (g: ArtifactGraphSnapshot) => void): string[] =>
    run(mutate).warnings.map((e) => e.code);

  const edge = (g: ArtifactGraphSnapshot, key: string) => g.edges.find((e) => e.key === key)!;
  const node = (g: ArtifactGraphSnapshot, key: string) => g.nodes.find((n) => n.key === key)!;

  function outputVar(
    code: string,
    dataType: string,
    usageType: string,
    dependencyPath: string,
  ): VariableContractSnapshot {
    return {
      variableVersionId: `v-${code}`,
      usageType,
      dependencyPath,
      code,
      version: 1,
      dataType,
      nullable: false,
      validationRules: [],
      sources: [],
      required: false,
      fallbackPolicy: 'FAIL_CLOSED',
      sensitive: false,
    };
  }

  const resultNode = (config: Record<string, unknown>): GraphNodeSnapshot => ({
    id: '50',
    key: 'RES',
    type: 'RESULT',
    label: 'Result',
    config,
    x: 300,
    y: 0,
    order: 5,
    terminal: true,
    conditions: [],
    actions: [],
  });

  describe('identifier and reference integrity', () => {
    it('flags duplicate keys across nodes, edges, conditions, actions and variables', () => {
      expect(errors((g) => g.edges.push({ ...g.edges[1] }))).toContain('DUPLICATE_EDGE_KEY');
      expect(errors((g) => g.conditions.push({ ...g.conditions[0] }))).toContain(
        'DUPLICATE_CONDITION_CODE',
      );
      expect(errors((g) => g.actions.push({ ...g.actions[0] }))).toContain('DUPLICATE_ACTION_CODE');
      expect(errors((g) => g.variables.push({ ...g.variables[0] }))).toContain(
        'DUPLICATE_VARIABLE_CODE',
      );
    });

    it('flags edges pointing at missing nodes and unknown conditions', () => {
      const codes = errors((g) =>
        g.edges.push({
          key: 'BAD',
          from: 'GHOST',
          to: 'PHANTOM',
          type: 'DEFAULT',
          priority: 5,
          default: true,
          conditions: [],
        }),
      );
      expect(codes).toContain('EDGE_FROM_NODE_MISSING');
      expect(codes).toContain('EDGE_TO_NODE_MISSING');
      expect(
        errors((g) => (edge(g, 'CHECK_APPROVE').conditions = [{ code: 'UNKNOWN', order: 1 }])),
      ).toContain('EDGE_CONDITION_MISSING');
    });

    it('flags node references to missing conditions and actions', () => {
      expect(
        errors((g) => (node(g, 'CHECK').conditions = [{ code: 'NOPE', order: 1, expected: true }])),
      ).toContain('NODE_CONDITION_MISSING');
      expect(
        errors((g) => (node(g, 'APPROVED').actions = [{ code: 'GHOST', order: 1 }])),
      ).toContain('NODE_ACTION_MISSING');
    });
  });

  describe('edge shape and default-edge invariants', () => {
    it('rejects a default edge that carries conditions', () => {
      expect(
        errors((g) => (edge(g, 'START_CHECK').conditions = [{ code: 'SCORE_OK', order: 1 }])),
      ).toContain('DEFAULT_EDGE_WITH_CONDITIONS');
    });

    it('rejects a conditional edge without any condition', () => {
      expect(errors((g) => (edge(g, 'CHECK_APPROVE').conditions = []))).toContain(
        'CONDITIONAL_EDGE_WITHOUT_CONDITION',
      );
    });

    it('rejects duplicate condition order on an edge', () => {
      expect(
        errors(
          (g) =>
            (edge(g, 'CHECK_APPROVE').conditions = [
              { code: 'SCORE_OK', order: 1 },
              { code: 'SCORE_OK', order: 1 },
            ]),
        ),
      ).toContain('DUPLICATE_EDGE_CONDITION_ORDER');
    });

    it('rejects more than one default edge and a missing fail-closed default', () => {
      expect(
        errors((g) =>
          g.edges.push({
            key: 'CHECK_DECLINE2',
            from: 'CHECK',
            to: 'DECLINED',
            type: 'DEFAULT',
            priority: 5,
            default: true,
            conditions: [],
          }),
        ),
      ).toContain('AMBIGUOUS_DEFAULT_EDGE');
      expect(errors((g) => (g.edges = g.edges.filter((e) => e.key !== 'CHECK_DECLINE')))).toContain(
        'MISSING_DEFAULT_EDGE',
      );
    });

    it('warns on duplicate non-default edge priorities', () => {
      expect(
        warnings((g) =>
          g.edges.push({
            key: 'CHECK_APPROVE2',
            from: 'CHECK',
            to: 'APPROVED',
            type: 'CONDITIONAL',
            priority: 1,
            default: false,
            conditions: [{ code: 'SCORE_OK', order: 1 }],
          }),
        ),
      ).toContain('DUPLICATE_EDGE_PRIORITY');
    });
  });

  describe('node shape invariants', () => {
    it('requires exactly one START node and at least one terminal node', () => {
      expect(
        errors((g) => g.nodes.push({ ...node(g, 'START'), key: 'START2', id: '88' })),
      ).toContain('START_NODE_COUNT');
      expect(
        errors((g) => {
          node(g, 'APPROVED').terminal = false;
          node(g, 'DECLINED').terminal = false;
          g.actions.forEach((a) => (a.terminal = false));
        }),
      ).toContain('NO_TERMINAL_NODE');
    });

    it('rejects a non-terminal node without an edge and a terminal node with one', () => {
      expect(
        errors((g) =>
          g.nodes.push({
            id: '77',
            key: 'ORPHAN',
            type: 'CONDITION',
            label: 'orphan',
            config: {},
            x: 0,
            y: 0,
            order: 9,
            terminal: false,
            conditions: [],
            actions: [],
          }),
        ),
      ).toContain('NON_TERMINAL_WITHOUT_EDGE');
      expect(
        errors((g) =>
          g.edges.push({
            key: 'APPROVED_CHECK',
            from: 'APPROVED',
            to: 'CHECK',
            type: 'DEFAULT',
            priority: 1,
            default: true,
            conditions: [],
          }),
        ),
      ).toContain('TERMINAL_NODE_WITH_EDGE');
    });

    it('rejects duplicate action order on a node', () => {
      expect(
        errors(
          (g) =>
            (node(g, 'APPROVED').actions = [
              { code: 'APPROVE', order: 1 },
              { code: 'APPROVE', order: 1 },
            ]),
        ),
      ).toContain('DUPLICATE_NODE_ACTION_ORDER');
    });

    it('warns that node-level conditions are metadata only', () => {
      expect(
        warnings(
          (g) => (node(g, 'CHECK').conditions = [{ code: 'SCORE_OK', order: 1, expected: true }]),
        ),
      ).toContain('NODE_CONDITIONS_METADATA_ONLY');
    });

    it('rejects an unsupported action type', () => {
      expect(errors((g) => (g.actions[0].type = 'BOGUS'))).toContain('UNSUPPORTED_ACTION_TYPE');
    });
  });

  describe('output contract rules', () => {
    it('requires exactly one primary output, a scalar type and the canonical path', () => {
      expect(
        errors((g) => g.variables.push(outputVar('grade', 'STRING', 'OUTPUT', 'output.grade'))),
      ).toContain('PRIMARY_OUTPUT_COUNT');
      expect(
        errors((g) => g.variables.push(outputVar('big', 'OBJECT', 'OUTPUT_PRIMARY', 'output.big'))),
      ).toContain('PRIMARY_OUTPUT_TYPE_INVALID');
      expect(
        errors((g) =>
          g.variables.push(outputVar('grade', 'STRING', 'OUTPUT_PRIMARY', 'wrong.path')),
        ),
      ).toContain('OUTPUT_PATH_INVALID');
    });
  });

  describe('RESULT node rules', () => {
    it('rejects an invalid mode and empty mapping assignments', () => {
      expect(errors((g) => g.nodes.push(resultNode({ mode: 'WEIRD' })))).toContain(
        'RESULT_MODE_INVALID',
      );
      expect(
        errors((g) => g.nodes.push(resultNode({ mode: 'MAPPING', assignments: [] }))),
      ).toContain('RESULT_ASSIGNMENTS_EMPTY');
    });

    it('rejects undeclared and duplicated output assignments', () => {
      expect(
        errors((g) =>
          g.nodes.push(
            resultNode({
              mode: 'MAPPING',
              assignments: [{ outputCode: 'ghost', source: 'LITERAL', value: 1 }],
            }),
          ),
        ),
      ).toContain('UNDECLARED_OUTPUT');
      expect(
        errors((g) =>
          g.nodes.push(
            resultNode({
              mode: 'MAPPING',
              assignments: [
                { outputCode: 'dup', source: 'LITERAL', value: 1 },
                { outputCode: 'dup', source: 'LITERAL', value: 2 },
              ],
            }),
          ),
        ),
      ).toContain('DUPLICATE_RESULT_ASSIGNMENT');
    });

    it('rejects an invalid script language and empty script source', () => {
      expect(
        errors((g) =>
          g.nodes.push(resultNode({ mode: 'SCRIPT', script: { language: 'RUBY', source: 'x' } })),
        ),
      ).toContain('RESULT_SCRIPT_LANGUAGE_INVALID');
      expect(
        errors((g) =>
          g.nodes.push(
            resultNode({ mode: 'SCRIPT', script: { language: 'JAVASCRIPT', source: '   ' } }),
          ),
        ),
      ).toContain('RESULT_SCRIPT_EMPTY');
    });
  });

  describe('expression and template references', () => {
    it('skips decision-scoped references and resolves the variables.* namespace like the runtime', () => {
      // decision.* is a runtime-only namespace, never a declared variable.
      expect(
        errors(
          (g) =>
            (g.conditions[0].expression = {
              op: 'eq',
              left: { var: 'decision.outcome' },
              right: { value: 'APPROVED' },
            }),
        ),
      ).not.toContain('UNDECLARED_VARIABLE_DEPENDENCY');
      // `variables.<code>` resolves at runtime to the same value as the bare `<code>` (the
      // context exposes both), so the validator must accept it against the declared `score`.
      expect(
        errors(
          (g) =>
            (g.conditions[0].expression = {
              op: 'eq',
              left: { var: 'variables.score' },
              right: { value: 600 },
            }),
        ),
      ).not.toContain('UNDECLARED_VARIABLE_DEPENDENCY');
      // An undeclared code under the same namespace is still flagged.
      expect(
        errors(
          (g) =>
            (g.conditions[0].expression = {
              op: 'eq',
              left: { var: 'variables.ghost' },
              right: { value: 1 },
            }),
        ),
      ).toContain('UNDECLARED_VARIABLE_DEPENDENCY');
    });

    it('flags undeclared template variables and skips decision/variables scopes', () => {
      expect(
        errors((g) => (g.actions[0].reasonCodes[0].publicMessage = 'Hi {{ ghost }}')),
      ).toContain('UNDECLARED_TEMPLATE_VARIABLE');
      expect(
        errors(
          (g) =>
            (g.actions[0].reasonCodes[0].publicMessage =
              '{{ decision.outcome }} {{ variables.score }}'),
        ),
      ).not.toContain('UNDECLARED_TEMPLATE_VARIABLE');
      expect(
        errors((g) => (g.actions[0].payload = { ...g.actions[0].payload, note: '{{ ghost }}' })),
      ).toContain('UNDECLARED_TEMPLATE_VARIABLE');
    });

    it('validates score expressions and component references', () => {
      expect(
        errors((g) => (node(g, 'CHECK').config = { scoreExpression: { var: 'ghost' } })),
      ).toContain('UNDECLARED_VARIABLE_DEPENDENCY');
      const codes = errors(
        (g) =>
          (node(g, 'CHECK').config = {
            components: [{ conditionCode: 'MISSING', pointsExpression: { var: 'ghost' } }],
          }),
      );
      expect(codes).toContain('SCORE_COMPONENT_CONDITION_MISSING');
      expect(codes).toContain('UNDECLARED_VARIABLE_DEPENDENCY');
    });

    it('validates RESULT assignment expression, template and variable sources', () => {
      const codes = errors((g) =>
        g.nodes.push(
          resultNode({
            mode: 'MAPPING',
            assignments: [
              { outputCode: 'x', source: 'EXPRESSION', expression: { var: 'ghost' } },
              { outputCode: 'y', source: 'TEMPLATE', value: '{{ ghost }}' },
              { outputCode: 'z', source: 'VARIABLE', variablePath: 'ghost' },
            ],
          }),
        ),
      );
      expect(codes).toContain('UNDECLARED_VARIABLE_DEPENDENCY');
      expect(codes).toContain('UNDECLARED_TEMPLATE_VARIABLE');
    });
  });

  describe('reachability and terminal-path rules', () => {
    it('flags an unreachable node', () => {
      expect(
        errors((g) =>
          g.nodes.push({
            id: '78',
            key: 'ISLAND',
            type: 'END',
            label: 'island',
            config: { outcome: 'X' },
            x: 0,
            y: 0,
            order: 9,
            terminal: false,
            conditions: [],
            actions: [],
          }),
        ),
      ).toContain('UNREACHABLE_NODE');
    });

    it('counts END and MANUAL_REVIEW nodes as terminal paths', () => {
      const report = run((g) => {
        const approved = node(g, 'APPROVED');
        approved.type = 'END';
        approved.actions = [];
        approved.config = { outcome: 'APPROVED' };
        const declined = node(g, 'DECLINED');
        declined.type = 'MANUAL_REVIEW';
        declined.actions = [];
      });
      expect(report.valid).toBe(true);
      expect(report.metrics.terminalPathCount).toBe(2);
    });

    it('flags a graph where START reaches no terminal path', () => {
      expect(
        errors((g) => {
          g.nodes = g.nodes.filter((n) => n.key === 'START' || n.key === 'CHECK');
          g.edges = g.edges.filter((e) => e.key === 'START_CHECK');
        }),
      ).toContain('NO_TERMINAL_PATH');
    });
  });
});
