import { DomainException } from '../src/common/errors/domain-exception';
import { ExpressionEvaluator } from '../src/modules/graph/expression-evaluator';

/**
 * Operator-by-operator coverage of the expression interpreter. This is the code that
 * turns a policy into a yes/no on money, so every operator, alias and failure edge is
 * pinned: an operator that silently changes behaviour is a mispriced or misdenied
 * decision, not a cosmetic bug.
 */
describe('ExpressionEvaluator operator coverage', () => {
  const evaluator = new ExpressionEvaluator();
  const evaluate = (expr: unknown, ctx: Record<string, unknown> = {}) =>
    evaluator.evaluate(expr, ctx);

  describe('structural passthrough', () => {
    it('returns primitives, null and undefined unchanged', () => {
      expect(evaluate(42)).toBe(42);
      expect(evaluate('literal')).toBe('literal');
      expect(evaluate(true)).toBe(true);
      expect(evaluate(null)).toBeNull();
      expect(evaluate(undefined)).toBeUndefined();
    });

    it('evaluates arrays element-wise', () => {
      expect(evaluate([{ value: 1 }, { var: 'a' }, 3], { a: 2 })).toEqual([1, 2, 3]);
    });

    it('reads a value node and resolves a dotted variable path', () => {
      expect(evaluate({ value: 42 })).toBe(42);
      expect(evaluate({ var: 'a.b.c' }, { a: { b: { c: 9 } } })).toBe(9);
    });

    it('resolves a path that runs off a non-object to undefined', () => {
      expect(evaluate({ var: 'a.b.c' }, { a: { b: 5 } })).toBeUndefined();
      expect(evaluate({ var: 'missing.deep' }, {})).toBeUndefined();
    });

    it('returns an object node verbatim when it carries no operator', () => {
      expect(evaluate({ foo: 1 })).toEqual({ foo: 1 });
    });
  });

  describe('logical operators', () => {
    const T = { op: 'eq', left: { value: 1 }, right: { value: 1 } };
    const F = { op: 'eq', left: { value: 1 }, right: { value: 2 } };

    it('and / or short-circuit on truthiness', () => {
      expect(evaluate({ op: 'and', args: [T, T] })).toBe(true);
      expect(evaluate({ op: 'and', args: [T, F] })).toBe(false);
      expect(evaluate({ op: 'or', args: [F, T] })).toBe(true);
      expect(evaluate({ op: 'or', args: [F, F] })).toBe(false);
    });

    it('not negates its arg (node.arg and args[0] forms)', () => {
      expect(evaluate({ op: 'not', arg: { value: false } })).toBe(true);
      expect(evaluate({ op: 'not', args: [{ value: true }] })).toBe(false);
    });

    it('coalesce returns the first non-null, else null', () => {
      expect(evaluate({ op: 'coalesce', args: [{ var: 'missing' }, { value: 'fallback' }] })).toBe(
        'fallback',
      );
      expect(evaluate({ op: 'coalesce', args: [{ var: 'missing' }] })).toBeNull();
    });

    it('if branches on its condition', () => {
      const node = (cond: boolean) => ({
        op: 'if',
        condition: { value: cond },
        then: { value: 'y' },
        else: { value: 'n' },
      });
      expect(evaluate(node(true))).toBe('y');
      expect(evaluate(node(false))).toBe('n');
    });

    it('exists and is_null test presence', () => {
      expect(evaluate({ op: 'exists', arg: { var: 'present' } }, { present: 0 })).toBe(true);
      expect(evaluate({ op: 'exists', arg: { var: 'missing' } })).toBe(false);
      expect(evaluate({ op: 'is_null', arg: { var: 'missing' } })).toBe(true);
      expect(evaluate({ op: 'is_null', arg: { var: 'present' } }, { present: 0 })).toBe(false);
    });
  });

  describe('equality and relational operators', () => {
    it('eq / neq compare by strict identity', () => {
      expect(evaluate({ op: 'eq', left: { value: 'A' }, right: { value: 'A' } })).toBe(true);
      expect(evaluate({ op: 'neq', left: { value: 'A' }, right: { value: 'B' } })).toBe(true);
    });

    it('honours the equals / not_equals aliases from the compact form', () => {
      expect(evaluate({ variable: 'x', operator: 'equals', value: 5 }, { x: 5 })).toBe(true);
      expect(evaluate({ variable: 'x', operator: 'not_equals', value: 5 }, { x: 6 })).toBe(true);
    });

    it('compares equal strings as neither greater nor less', () => {
      expect(evaluate({ op: 'gte', left: { value: 'a' }, right: { value: 'a' } })).toBe(true);
      expect(evaluate({ op: 'lte', left: { value: 'a' }, right: { value: 'a' } })).toBe(true);
    });

    it('orders valid dates chronologically', () => {
      expect(
        evaluate({
          op: 'gt',
          left: { value: new Date('2026-02-01') },
          right: { value: new Date('2026-01-01') },
        }),
      ).toBe(true);
    });
  });

  describe('membership and string operators', () => {
    it('in / not_in test array membership and fail closed on a non-array', () => {
      expect(evaluate({ op: 'in', left: { value: 'B' }, right: { value: ['A', 'B'] } })).toBe(true);
      expect(evaluate({ op: 'not_in', left: { value: 'C' }, right: { value: ['A', 'B'] } })).toBe(
        true,
      );
      expect(evaluate({ op: 'in', left: { value: 'B' }, right: { value: 5 } })).toBe(false);
    });

    it('contains works over arrays and strings', () => {
      expect(evaluate({ op: 'contains', left: { value: ['A', 'B'] }, right: { value: 'A' } })).toBe(
        true,
      );
      expect(evaluate({ op: 'contains', left: { value: 'hello' }, right: { value: 'ell' } })).toBe(
        true,
      );
      expect(evaluate({ op: 'contains', left: { value: 7 }, right: { value: 7 } })).toBe(false);
    });

    it('starts_with / ends_with only match strings', () => {
      expect(
        evaluate({ op: 'starts_with', left: { value: 'abcdef' }, right: { value: 'abc' } }),
      ).toBe(true);
      expect(
        evaluate({ op: 'ends_with', left: { value: 'abcdef' }, right: { value: 'def' } }),
      ).toBe(true);
      expect(evaluate({ op: 'starts_with', left: { value: 123 }, right: { value: '1' } })).toBe(
        false,
      );
    });
  });

  describe('arithmetic operators', () => {
    it('add / sub / mul compute left-to-right', () => {
      expect(evaluate({ op: 'add', args: [{ value: 2 }, { value: 3 }, { value: 5 }] })).toBe(10);
      expect(evaluate({ op: 'sub', args: [{ value: 10 }, { value: 3 }, { value: 2 }] })).toBe(5);
      expect(evaluate({ op: 'mul', args: [{ value: 2 }, { value: 3 }, { value: 4 }] })).toBe(24);
    });

    it('sub with no args is zero rather than NaN', () => {
      expect(evaluate({ op: 'sub', args: [] })).toBe(0);
    });

    it('div returns the quotient for a non-zero divisor', () => {
      expect(evaluate({ op: 'div', left: { value: 9 }, right: { value: 3 } })).toBe(3);
    });

    it('min / max reduce their arguments', () => {
      expect(evaluate({ op: 'min', args: [{ value: 5 }, { value: 2 }, { value: 9 }] })).toBe(2);
      expect(evaluate({ op: 'max', args: [{ value: 5 }, { value: 2 }, { value: 9 }] })).toBe(9);
    });

    it('round honours an explicit precision and defaults to integer', () => {
      expect(evaluate({ op: 'round', arg: { value: 1.2345 }, precision: 2 })).toBe(1.23);
      expect(evaluate({ op: 'round', arg: { value: 2.6 } })).toBe(3);
    });

    it('rejects a non-numeric arithmetic operand instead of coercing to NaN', () => {
      expect(() => evaluate({ op: 'add', args: [{ value: 'abc' }, { value: 1 }] })).toThrow(
        DomainException,
      );
    });
  });

  describe('positional args form', () => {
    // Operators accept either named operands (left/right/arg) or a positional args array;
    // the array form is the fallback branch, exercised here.
    it('evaluates comparison, division, rounding and presence from args', () => {
      expect(evaluate({ op: 'gt', args: [{ value: 5 }, { value: 3 }] })).toBe(true);
      expect(evaluate({ op: 'div', args: [{ value: 9 }, { value: 3 }] })).toBe(3);
      expect(evaluate({ op: 'round', args: [{ value: 2.6 }] })).toBe(3);
      expect(evaluate({ op: 'exists', args: [{ var: 'present' }] }, { present: 1 })).toBe(true);
      expect(evaluate({ op: 'is_null', args: [{ var: 'missing' }] })).toBe(true);
    });
  });

  describe('unsupported operators', () => {
    it('throws on an unknown op node', () => {
      expect(() => evaluate({ op: 'frobnicate', args: [] })).toThrow(DomainException);
    });

    it('throws on an unknown operator in the compact form', () => {
      expect(() => evaluate({ variable: 'x', operator: 'weird', value: 1 }, { x: 1 })).toThrow(
        DomainException,
      );
    });
  });
});
