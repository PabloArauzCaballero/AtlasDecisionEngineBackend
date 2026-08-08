import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';

export type EvaluationContext = Record<string, unknown>;

/**
 * Deterministic interpreter for the decision expression AST.
 *
 * It avoids locale-dependent comparison and rejects invalid arithmetic or date operands
 * instead of silently changing a decision outcome.
 */
@Injectable()
export class ExpressionEvaluator {
  /** Evaluates one expression node against the supplied variable context. */
  evaluate(expression: unknown, context: EvaluationContext): unknown {
    if (expression === null || expression === undefined) return expression;
    if (typeof expression !== 'object') return expression;
    if (Array.isArray(expression)) return expression.map((item) => this.evaluate(item, context));

    const node = expression as Record<string, unknown>;
    if ('var' in node) return this.resolvePath(context, String(node.var));
    if ('value' in node && Object.keys(node).length === 1) return node.value;

    if ('variable' in node && 'operator' in node) {
      const left = this.resolvePath(context, String(node.variable));
      return this.applyOperator(String(node.operator), left, node.value, context);
    }

    const op = String(node.op ?? '').toLowerCase();
    if (!op) return node;

    const args = Array.isArray(node.args) ? node.args : [];
    switch (op) {
      case 'and':
        return args.every((arg) => Boolean(this.evaluate(arg, context)));
      case 'or':
        return args.some((arg) => Boolean(this.evaluate(arg, context)));
      case 'not':
        return !this.evaluate(node.arg ?? args[0], context);
      case 'coalesce': {
        for (const arg of args) {
          const value = this.evaluate(arg, context);
          if (value !== null && value !== undefined) return value;
        }
        return null;
      }
      case 'if':
        return this.evaluate(node.condition, context)
          ? this.evaluate(node.then, context)
          : this.evaluate(node.else, context);
      case 'exists': {
        const value = this.evaluate(node.arg ?? node.left ?? args[0], context);
        return value !== undefined && value !== null;
      }
      case 'is_null':
        return this.evaluate(node.arg ?? node.left ?? args[0], context) == null;
      case 'eq':
      case 'neq':
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
      case 'in':
      case 'not_in':
      case 'contains':
      case 'starts_with':
      case 'ends_with':
        return this.applyOperator(
          op,
          this.evaluate(node.left ?? args[0], context),
          this.evaluate(node.right ?? args[1], context),
          context,
        );
      case 'add':
        return args.reduce<number>(
          (sum, arg) => sum + this.asNumber(this.evaluate(arg, context)),
          0,
        );
      case 'sub': {
        const values = args.map((arg) => this.asNumber(this.evaluate(arg, context)));
        return values.slice(1).reduce((result, item) => result - item, values[0] ?? 0);
      }
      case 'mul':
        return args.reduce<number>(
          (product, arg) => product * this.asNumber(this.evaluate(arg, context)),
          1,
        );
      case 'div': {
        const left = this.asNumber(this.evaluate(node.left ?? args[0], context));
        const right = this.asNumber(this.evaluate(node.right ?? args[1], context));
        if (right === 0)
          throw new DomainException('EXPRESSION_DIVISION_BY_ZERO', 'Division by zero');
        return left / right;
      }
      case 'min': {
        if (!args.length)
          throw new DomainException(
            'EXPRESSION_INVALID_ARGUMENTS',
            'min requires at least one argument',
          );
        return Math.min(...args.map((arg) => this.asNumber(this.evaluate(arg, context))));
      }
      case 'max': {
        if (!args.length)
          throw new DomainException(
            'EXPRESSION_INVALID_ARGUMENTS',
            'max requires at least one argument',
          );
        return Math.max(...args.map((arg) => this.asNumber(this.evaluate(arg, context))));
      }
      case 'round': {
        const value = this.asNumber(this.evaluate(node.arg ?? args[0], context));
        const precision = Number(node.precision ?? 0);
        const factor = 10 ** precision;
        return Math.round(value * factor) / factor;
      }
      default:
        throw new DomainException('UNSUPPORTED_EXPRESSION_OPERATOR', `Unsupported operator: ${op}`);
    }
  }

  /** Returns the top-level variable names referenced anywhere in an expression tree. */
  referencedVariables(expression: unknown): Set<string> {
    const found = new Set<string>();
    const walk = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      const node = value as Record<string, unknown>;
      if (typeof node.var === 'string') found.add(this.referenceRoot(node.var));
      if (typeof node.variable === 'string') found.add(this.referenceRoot(node.variable));
      Object.values(node).forEach(walk);
    };
    walk(expression);
    return found;
  }

  /**
   * Root name a `var`/`variable` path refers to. A leading `variables.` is the variables
   * namespace (the runtime context exposes each variable both as `<code>` and under
   * `variables.<code>`), so it is stripped and the reported root is the variable code itself —
   * not the literal word "variables". Any other prefix (`decision.*`, `customer.*`, …) keeps its
   * first segment, so the graph validator resolves references the same way the runtime does.
   *
   * `intermediate.*` es la excepción: ahí el primer segmento nombra el espacio de nombres,
   * no la variable, así que se conserva el código completo (`intermediate.dti`). Devolver
   * solo "intermediate" haría imposible comprobar QUÉ variable intermedia se está leyendo.
   */
  private referenceRoot(path: string): string {
    if (path.startsWith('intermediate.')) {
      return `intermediate.${path.slice('intermediate.'.length).split('.')[0]}`;
    }
    const bare = path.startsWith('variables.') ? path.slice('variables.'.length) : path;
    return bare.split('.')[0];
  }

  private applyOperator(
    operator: string,
    left: unknown,
    right: unknown,
    _context: EvaluationContext,
  ): boolean {
    switch (operator.toLowerCase()) {
      case 'eq':
      case 'equals':
        return left === right;
      case 'neq':
      case 'not_equals':
        return left !== right;
      case 'gt':
        return this.compare(left, right) > 0;
      case 'gte':
        return this.compare(left, right) >= 0;
      case 'lt':
        return this.compare(left, right) < 0;
      case 'lte':
        return this.compare(left, right) <= 0;
      case 'in':
        return Array.isArray(right) && right.includes(left);
      case 'not_in':
        return Array.isArray(right) && !right.includes(left);
      case 'contains':
        return Array.isArray(left)
          ? left.includes(right)
          : typeof left === 'string' && left.includes(String(right));
      case 'starts_with':
        return typeof left === 'string' && left.startsWith(String(right));
      case 'ends_with':
        return typeof left === 'string' && left.endsWith(String(right));
      default:
        throw new DomainException(
          'UNSUPPORTED_EXPRESSION_OPERATOR',
          `Unsupported operator: ${operator}`,
        );
    }
  }

  private resolvePath(context: EvaluationContext, path: string): unknown {
    return path.split('.').reduce<unknown>((value, key) => {
      if (value && typeof value === 'object') return (value as Record<string, unknown>)[key];
      return undefined;
    }, context);
  }

  /**
   * Ordena dos operandos, o falla cerrado si no son comparables entre sí.
   *
   * Antes, todo lo que no fuesen dos números o una fecha caía en `String(left)` vs
   * `String(right)`, y eso convertía un dato ausente en una decisión favorable: con
   * `bureau_score` sin resolver, `bureau_score >= 600` comparaba `"undefined"` con `"600"`
   * y devolvía **true**, igual que `"80" >= 600`. Una comparación de orden solo tiene
   * sentido entre valores del mismo tipo ordenable; cualquier otra combinación es un error
   * del contrato o del grafo, y el motor debe decirlo en vez de inventarse un resultado.
   */
  private compare(left: unknown, right: unknown): number {
    if (typeof left === 'number' && typeof right === 'number') {
      if (!Number.isFinite(left) || !Number.isFinite(right)) {
        throw new DomainException(
          'EXPRESSION_INCOMPARABLE_OPERANDS',
          'Cannot order a non-finite numeric value',
        );
      }
      return left - right;
    }
    if (left instanceof Date || right instanceof Date) {
      const leftTime = new Date(String(left)).getTime();
      const rightTime = new Date(String(right)).getTime();
      // An unparseable date yields NaN, which would make every comparison silently false.
      // A decision must never turn on a value the engine could not actually interpret.
      if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
        throw new DomainException(
          'EXPRESSION_INVALID_DATE',
          'Cannot compare an invalid date value',
        );
      }
      return leftTime - rightTime;
    }
    if (typeof left === 'string' && typeof right === 'string') {
      // Compare by Unicode code point, not localeCompare: locale/ICU differences between
      // environments must never change a decision outcome (regulatory reproducibility).
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    }
    throw new DomainException(
      'EXPRESSION_INCOMPARABLE_OPERANDS',
      `Cannot order ${describeOperand(left)} against ${describeOperand(right)}; ` +
        'use exists/is_null or align the declared data types',
    );
  }

  private asNumber(value: unknown): number {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number)) {
      throw new DomainException(
        'EXPRESSION_NOT_NUMERIC',
        `Expected numeric value, got ${String(value)}`,
      );
    }
    return number;
  }
}

/** Describes an operand for an error message without leaking its value (may be PII). */
function describeOperand(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'a missing value';
  if (Array.isArray(value)) return 'an array';
  return `a value of type ${typeof value}`;
}
