import { safeRegexTest } from '../../validation/safe-regex';
import { checkTypeShape } from '../data-types';
import type { ConstraintViolation, VariableConstraints } from '../constraints.types';
import { decimalsOf, significantDigits, violation } from './conditions-and-helpers';
import { FORMAT_PATTERNS } from './parse-and-resolve';

export function checkNumeric(
  constraints: VariableConstraints,
  value: number,
  violations: ConstraintViolation[],
): void {
  if (constraints.min !== undefined && value < constraints.min) {
    violations.push(violation('BELOW_MINIMUM', 'min', `is below minimum ${constraints.min}`));
  }
  if (constraints.max !== undefined && value > constraints.max) {
    violations.push(violation('ABOVE_MAXIMUM', 'max', `is above maximum ${constraints.max}`));
  }
  if (constraints.exclusiveMin !== undefined && value <= constraints.exclusiveMin) {
    violations.push(
      violation(
        'BELOW_MINIMUM',
        'exclusiveMin',
        `must be greater than ${constraints.exclusiveMin}`,
      ),
    );
  }
  if (constraints.exclusiveMax !== undefined && value >= constraints.exclusiveMax) {
    violations.push(
      violation('ABOVE_MAXIMUM', 'exclusiveMax', `must be lower than ${constraints.exclusiveMax}`),
    );
  }
  if (constraints.scale !== undefined && decimalsOf(value) > constraints.scale) {
    violations.push(
      violation('SCALE_EXCEEDED', 'scale', `allows at most ${constraints.scale} decimals`),
    );
  }
  if (constraints.precision !== undefined && significantDigits(value) > constraints.precision) {
    violations.push(
      violation(
        'PRECISION_EXCEEDED',
        'precision',
        `allows at most ${constraints.precision} significant digits`,
      ),
    );
  }
}

export function checkText(
  constraints: VariableConstraints,
  value: string,
  violations: ConstraintViolation[],
): void {
  if (constraints.minLength !== undefined && value.length < constraints.minLength) {
    violations.push(
      violation('TOO_SHORT', 'minLength', `is shorter than ${constraints.minLength}`),
    );
  }
  if (constraints.maxLength !== undefined && value.length > constraints.maxLength) {
    violations.push(violation('TOO_LONG', 'maxLength', `is longer than ${constraints.maxLength}`));
  }
  if (constraints.pattern && !safeRegexTest(constraints.pattern, value).matched) {
    violations.push(
      violation('PATTERN_MISMATCH', 'pattern', 'does not match the required pattern'),
    );
  }
  const formatPattern = constraints.format ? FORMAT_PATTERNS[constraints.format] : undefined;
  if (formatPattern && !formatPattern.test(value)) {
    violations.push(
      violation('FORMAT_INVALID', 'format', `is not a valid ${constraints.format?.toLowerCase()}`),
    );
  }
}

export function checkList(
  constraints: VariableConstraints,
  value: unknown[],
  violations: ConstraintViolation[],
): void {
  if (constraints.minItems !== undefined && value.length < constraints.minItems) {
    violations.push(
      violation('TOO_FEW_ITEMS', 'minItems', `has fewer than ${constraints.minItems} items`),
    );
  }
  if (constraints.maxItems !== undefined && value.length > constraints.maxItems) {
    violations.push(
      violation('TOO_MANY_ITEMS', 'maxItems', `has more than ${constraints.maxItems} items`),
    );
  }
  if (constraints.unique) {
    const seen = new Set(value.map((item) => JSON.stringify(item)));
    if (seen.size !== value.length) {
      violations.push(violation('DUPLICATE_ITEMS', 'unique', 'must not contain duplicate items'));
    }
  }
  if (constraints.itemType) {
    const bad = value.findIndex((item) => !checkTypeShape(constraints.itemType!, item).ok);
    if (bad >= 0) {
      violations.push(
        violation(
          'ITEM_TYPE_MISMATCH',
          'itemType',
          `item ${bad} is not of type ${constraints.itemType}`,
        ),
      );
    }
  }
}
