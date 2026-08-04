import { DomainException } from '../src/common/errors/domain-exception';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';

describe('ExpressionEvaluator', () => {
  const evaluator = new ExpressionEvaluator();

  it('evaluates nested boolean and arithmetic expressions deterministically', () => {
    const expression = {
      op: 'and',
      args: [
        { op: 'gte', left: { var: 'bureau_score' }, right: { value: 600 } },
        {
          op: 'lte',
          left: { op: 'mul', args: [{ var: 'requested_amount' }, { value: 1.0 }] },
          right: { op: 'mul', args: [{ var: 'monthly_income' }, { value: 0.5 }] },
        },
      ],
    };
    expect(
      evaluator.evaluate(expression, {
        bureau_score: 720,
        requested_amount: 2000,
        monthly_income: 5000,
      }),
    ).toBe(true);
  });

  it('returns every referenced root variable', () => {
    const references = evaluator.referencedVariables({
      op: 'and',
      args: [
        { op: 'eq', left: { var: 'customer.kyc' }, right: { value: 'OK' } },
        { variable: 'bureau_score', operator: 'gte', value: 600 },
      ],
    });
    expect([...references].sort()).toEqual(['bureau_score', 'customer']);
  });

  it('unwraps the variables.* namespace to the bare variable code', () => {
    // `variables.score` resolves at runtime to the same value as `score`, so the referenced
    // root is the code itself — never the literal namespace word. `decision.*` keeps its root.
    const references = evaluator.referencedVariables({
      op: 'and',
      args: [
        { var: 'variables.score' },
        { var: 'variables.bureau_score.band' },
        { var: 'decision.outcome' },
        { var: 'monthly_income' },
      ],
    });
    expect([...references].sort()).toEqual(['bureau_score', 'decision', 'monthly_income', 'score']);
  });

  it('evaluates the compact expression produced by the no-code condition editor', () => {
    expect(
      evaluator.evaluate({ variable: 'score', operator: 'gte', value: 600 }, { score: 700 }),
    ).toBe(true);
  });

  it('fails closed for division by zero', () => {
    expect(() =>
      evaluator.evaluate({ op: 'div', left: { value: 1 }, right: { value: 0 } }, {}),
    ).toThrow(DomainException);
  });

  it('orders strings by code point independent of locale', () => {
    // 'Z' (0x5A) precedes 'a' (0x61) by code point; a locale-aware collation would reverse it.
    expect(evaluator.evaluate({ op: 'lt', left: { value: 'Z' }, right: { value: 'a' } }, {})).toBe(
      true,
    );
    expect(evaluator.evaluate({ op: 'gt', left: { value: 'a' }, right: { value: 'Z' } }, {})).toBe(
      true,
    );
  });

  it('rejects a comparison against an invalid date instead of silently returning false', () => {
    expect(() =>
      evaluator.evaluate(
        { op: 'gt', left: { value: new Date('2026-01-01') }, right: { value: 'not-a-date' } },
        {},
      ),
    ).toThrow(DomainException);
  });

  it('rejects min/max with no arguments instead of returning infinity', () => {
    expect(() => evaluator.evaluate({ op: 'min', args: [] }, {})).toThrow(DomainException);
    expect(() => evaluator.evaluate({ op: 'max', args: [] }, {})).toThrow(DomainException);
  });

  it('orders strings by code point independent of locale', () => {
    // 'Z' (0x5A) precedes 'a' (0x61) by code point; a locale-aware collation would reverse it.
    expect(evaluator.evaluate({ op: 'lt', left: { value: 'Z' }, right: { value: 'a' } }, {})).toBe(
      true,
    );
    expect(evaluator.evaluate({ op: 'gt', left: { value: 'a' }, right: { value: 'Z' } }, {})).toBe(
      true,
    );
  });

  it('rejects a comparison against an invalid date instead of silently returning false', () => {
    expect(() =>
      evaluator.evaluate(
        { op: 'gt', left: { value: new Date('2026-01-01') }, right: { value: 'not-a-date' } },
        {},
      ),
    ).toThrow(DomainException);
  });

  it('rejects min/max with no arguments instead of returning infinity', () => {
    expect(() => evaluator.evaluate({ op: 'min', args: [] }, {})).toThrow(DomainException);
    expect(() => evaluator.evaluate({ op: 'max', args: [] }, {})).toThrow(DomainException);
  });
});
