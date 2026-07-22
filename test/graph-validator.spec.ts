import { ConfigService } from '@nestjs/config';
import { HashService } from '../src/common/crypto/hash.service';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';
import { GraphValidatorService } from '../src/modules/graph/graph-validator.service';
import { graphSnapshot } from './graph.fixture';

describe('GraphValidatorService', () => {
  const hash = new HashService(
    new ConfigService({ AUDIT_HASH_SECRET: 'test-secret-that-is-long-enough' }),
  );
  const validator = new GraphValidatorService(new ExpressionEvaluator(), hash);

  it('accepts a connected deterministic graph with terminal outcomes', () => {
    const report = validator.validate(graphSnapshot());
    expect(report.valid).toBe(true);
    expect(report.metrics.terminalPathCount).toBe(2);
    expect(report.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects cycles without recursing indefinitely', () => {
    const graph = graphSnapshot();
    graph.nodes.find((node) => node.key === 'APPROVED')!.terminal = false;
    graph.actions.find((action) => action.code === 'APPROVE')!.terminal = false;
    graph.edges.push({
      key: 'APPROVED_CHECK',
      from: 'APPROVED',
      to: 'CHECK',
      type: 'DEFAULT',
      priority: 1,
      default: true,
      conditions: [],
    });
    const report = validator.validate(graph);
    expect(report.valid).toBe(false);
    expect(report.errors.some((error) => error.code === 'PROHIBITED_CYCLE')).toBe(true);
    expect(report.metrics.terminalPathCount).toBe(0);
  });

  it('rejects undeclared variables', () => {
    const graph = graphSnapshot();
    graph.conditions[0].expression = {
      op: 'eq',
      left: { var: 'unknown_variable' },
      right: { value: true },
    };
    const report = validator.validate(graph);
    expect(report.errors.some((error) => error.code === 'UNDECLARED_VARIABLE_DEPENDENCY')).toBe(
      true,
    );
  });
  it('rejects duplicate identifiers before compilation', () => {
    const graph = graphSnapshot();
    graph.nodes.push({ ...graph.nodes[1], id: '99' });
    const report = validator.validate(graph);
    expect(report.errors.some((error) => error.code === 'DUPLICATE_NODE_KEY')).toBe(true);
  });

  it('rejects undeclared variables inside action expressions', () => {
    const graph = graphSnapshot();
    graph.actions[0].type = 'SET_LIMIT';
    graph.actions[0].payload = {
      valueExpression: { op: 'mul', args: [{ var: 'hidden_income' }, { value: 0.3 }] },
    };
    const report = validator.validate(graph);
    expect(report.errors.some((error) => error.code === 'UNDECLARED_VARIABLE_DEPENDENCY')).toBe(
      true,
    );
  });
});
