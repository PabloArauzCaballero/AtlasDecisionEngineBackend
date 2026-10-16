import type { ConditionalRule, ConstraintViolation, ScopedConstraint } from '../constraints.types';

export function matchesCondition(
  rule: ConditionalRule,
  siblings: Record<string, unknown>,
): boolean {
  const observed = siblings[rule.whenField];
  switch (rule.operator) {
    case 'EQUALS':
      return observed === rule.value;
    case 'NOT_EQUALS':
      return observed !== rule.value;
    case 'IN':
      return Array.isArray(rule.value) && includesValue(rule.value, observed);
    case 'NOT_IN':
      return Array.isArray(rule.value) && !includesValue(rule.value, observed);
    case 'GREATER_THAN':
      return (
        typeof observed === 'number' && typeof rule.value === 'number' && observed > rule.value
      );
    case 'LESS_THAN':
      return (
        typeof observed === 'number' && typeof rule.value === 'number' && observed < rule.value
      );
    case 'PRESENT':
      return observed !== undefined && observed !== null;
    case 'ABSENT':
      return observed === undefined || observed === null;
    default:
      return false;
  }
}

export function includesValue(candidates: unknown[], value: unknown): boolean {
  return candidates.some((candidate) => candidate === value || deepEquals(candidate, value));
}

function deepEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || !left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

export function decimalsOf(value: number): number {
  const text = String(value);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

export function significantDigits(value: number): number {
  return String(Math.abs(value)).replace(/[.\-]|^0+/g, '').length;
}

export function violation(code: string, constraint: string, message: string): ConstraintViolation {
  return { code, constraint, message };
}

export function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined;
}

export function scopedArray(value: unknown): ScopedConstraint[] | undefined {
  return Array.isArray(value) ? (value as ScopedConstraint[]) : undefined;
}
