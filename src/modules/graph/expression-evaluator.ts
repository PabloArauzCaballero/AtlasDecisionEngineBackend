import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';

export type EvaluationContext = Record<string, unknown>;

@Injectable()
export class ExpressionEvaluator {
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
        return !Boolean(this.evaluate(node.arg ?? args[0], context));
      case 'coalesce': {
        for (const arg of args) {
          const value = this.evaluate(arg, context);
          if (value !== null && value !== undefined) return value;
        }
        return null;
      }
      case 'if':
        return Boolean(this.evaluate(node.condition, context))
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
        return args.reduce<number>((sum, arg) => sum + this.asNumber(this.evaluate(arg, context)), 0);
      case 'sub': {
        const values = args.map((arg) => this.asNumber(this.evaluate(arg, context)));
        return values.slice(1).reduce((result, item) => result - item, values[0] ?? 0);
      }
      case 'mul':
        return args.reduce<number>((product, arg) => product * this.asNumber(this.evaluate(arg, context)), 1);
      case 'div': {
        const left = this.asNumber(this.evaluate(node.left ?? args[0], context));
        const right = this.asNumber(this.evaluate(node.right ?? args[1], context));
        if (right === 0) throw new DomainException('EXPRESSION_DIVISION_BY_ZERO', 'Division by zero');
        return left / right;
      }
      case 'min':
        return Math.min(...args.map((arg) => this.asNumber(this.evaluate(arg, context))));
      case 'max':
        return Math.max(...args.map((arg) => this.asNumber(this.evaluate(arg, context))));
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

  referencedVariables(expression: unknown): Set<string> {
    const found = new Set<string>();
    const walk = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      const node = value as Record<string, unknown>;
      if (typeof node.var === 'string') found.add(node.var.split('.')[0]);
      if (typeof node.variable === 'string') found.add(node.variable.split('.')[0]);
      Object.values(node).forEach(walk);
    };
    walk(expression);
    return found;
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

  private compare(left: unknown, right: unknown): number {
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    if (left instanceof Date || right instanceof Date) {
      return new Date(String(left)).getTime() - new Date(String(right)).getTime();
    }
    return String(left).localeCompare(String(right));
  }

  private asNumber(value: unknown): number {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number)) {
      throw new DomainException('EXPRESSION_NOT_NUMERIC', `Expected numeric value, got ${String(value)}`);
    }
    return number;
  }
}
