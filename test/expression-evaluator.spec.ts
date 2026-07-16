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

  it('evaluates the compact expression produced by the no-code condition editor', () => {
    expect(
      evaluator.evaluate(
        { variable: 'score', operator: 'gte', value: 600 },
        { score: 700 },
      ),
    ).toBe(true);
  });

  it('fails closed for division by zero', () => {
    expect(() => evaluator.evaluate({ op: 'div', left: { value: 1 }, right: { value: 0 } }, {})).toThrow(DomainException);
  });
});
