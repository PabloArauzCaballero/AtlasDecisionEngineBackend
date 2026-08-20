/**
 * Motor de restricciones del contrato (§1.2): interpreta la definición declarativa
 * persistida y la impone ANTES de cualquier ejecución.
 *
 * Es la única implementación autoritativa. El frontend puede reproducir estas mismas
 * reglas para dar feedback inmediato, pero su resultado no se acepta como prueba: el
 * backend siempre reevalúa.
 */
import { safeRegexTest } from '../validation/safe-regex';
import {
  checkTypeShape,
  normalizeDataTypeOrString,
  NUMERIC_TYPES,
  type DataType,
} from './data-types';
import type {
  ConditionalRule,
  ConstraintContext,
  ConstraintViolation,
  ScopedConstraint,
  VariableConstraints,
} from './constraints.types';
import { EMPTY_CONTEXT } from './constraints.types';

const FORMAT_PATTERNS: Readonly<Record<string, RegExp>> = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
  UUID: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  ISO_COUNTRY: /^[A-Z]{2}$/,
  ISO_CURRENCY: /^[A-Z]{3}$/,
  URL: /^https?:\/\/[^\s]+$/,
  PHONE: /^\+?[0-9][0-9\s-]{5,19}$/,
  IBAN: /^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/,
};

/** Interpreta el JSON persistido como restricciones tipadas, tolerando datos legados. */
export function parseConstraints(raw: unknown): VariableConstraints {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  // Compatibilidad con los contratos guardados como JSON Schema antes de §1.1.
  const legacy: VariableConstraints = {
    min: numberOrUndefined(source.min ?? source.minimum),
    max: numberOrUndefined(source.max ?? source.maximum),
    exclusiveMin: numberOrUndefined(source.exclusiveMin ?? source.exclusiveMinimum),
    exclusiveMax: numberOrUndefined(source.exclusiveMax ?? source.exclusiveMaximum),
    minLength: numberOrUndefined(source.minLength),
    maxLength: numberOrUndefined(source.maxLength),
    minItems: numberOrUndefined(source.minItems),
    maxItems: numberOrUndefined(source.maxItems),
    precision: numberOrUndefined(source.precision),
    scale: numberOrUndefined(source.scale),
    pattern: typeof source.pattern === 'string' ? source.pattern : undefined,
    allowedValues: Array.isArray(source.allowedValues)
      ? source.allowedValues
      : Array.isArray(source.enum)
        ? source.enum
        : undefined,
    format: typeof source.format === 'string' ? source.format.toUpperCase() : undefined,
    unique: typeof source.unique === 'boolean' ? source.unique : undefined,
    nullable: typeof source.nullable === 'boolean' ? source.nullable : undefined,
    dependsOn: stringArray(source.dependsOn),
    conditional: Array.isArray(source.conditional)
      ? (source.conditional as ConditionalRule[])
      : undefined,
    byCountry: scopedArray(source.byCountry),
    byProduct: scopedArray(source.byProduct),
    byEnvironment: scopedArray(source.byEnvironment),
    byTenant: scopedArray(source.byTenant),
    byContractVersion: scopedArray(source.byContractVersion),
    itemType:
      typeof source.itemType === 'string' ? normalizeDataTypeOrString(source.itemType) : undefined,
  };
  return Object.fromEntries(
    Object.entries(legacy).filter(([, value]) => value !== undefined),
  ) as VariableConstraints;
}

/**
 * Aplana las restricciones acotadas por país/producto/ambiente/tenant/versión sobre
 * la base, quedándose solo con los tramos que aplican al contexto de esta ejecución.
 */
export function resolveConstraints(
  base: VariableConstraints,
  context: ConstraintContext = EMPTY_CONTEXT,
): VariableConstraints {
  const axes: Array<[ScopedConstraint[] | undefined, string | undefined]> = [
    [base.byCountry, context.country],
    [base.byProduct, context.product],
    [base.byEnvironment, context.environmentCode],
    [base.byTenant, context.tenantId],
    [base.byContractVersion, context.contractVersion],
  ];
  let resolved: VariableConstraints = { ...base };
  for (const [scoped, actual] of axes) {
    for (const entry of scoped ?? []) {
      const applies =
        !entry.match?.length || (actual !== undefined && entry.match.includes(actual));
      if (applies) resolved = { ...resolved, ...entry.constraints };
    }
  }
  for (const rule of base.conditional ?? []) {
    if (matchesCondition(rule, context.siblings) && rule.constraints) {
      resolved = { ...resolved, ...rule.constraints };
    }
  }
  return resolved;
}

/** ¿Es el campo obligatorio en este contexto, contando reglas condicionales? */
export function isRequiredIn(
  baseRequired: boolean,
  constraints: VariableConstraints,
  context: ConstraintContext = EMPTY_CONTEXT,
): boolean {
  if (baseRequired) return true;
  return (constraints.conditional ?? []).some(
    (rule) => rule.required === true && matchesCondition(rule, context.siblings),
  );
}

/**
 * Valida `value` contra el tipo y las restricciones ya resueltas. Devuelve todas las
 * violaciones, no solo la primera: el autor arregla el contrato de una vez.
 */
export function validateAgainstConstraints(
  dataType: DataType | string,
  rawConstraints: VariableConstraints,
  value: unknown,
  context: ConstraintContext = EMPTY_CONTEXT,
): ConstraintViolation[] {
  const type = normalizeDataTypeOrString(String(dataType));
  const constraints = resolveConstraints(rawConstraints, context);
  const violations: ConstraintViolation[] = [];

  const shape = checkTypeShape(type, value);
  if (!shape.ok) {
    // Sin la forma correcta, el resto de restricciones compararía peras con manzanas.
    // El mensaje conserva el nombre de tipo TAL COMO lo declaró el contrato (no el
    // canónico) para que el autor reconozca lo que escribió.
    return [
      {
        code: 'TYPE_MISMATCH',
        constraint: 'dataType',
        message: `must be of type ${String(dataType).toUpperCase()}${shape.reason ? ` (${shape.reason})` : ''}`,
      },
    ];
  }

  if (NUMERIC_TYPES.has(type) && typeof value === 'number') {
    checkNumeric(constraints, value, violations);
  }
  if (typeof value === 'string') {
    checkText(constraints, value, violations);
  }
  if (Array.isArray(value)) {
    checkList(constraints, value, violations);
  }
  if (constraints.allowedValues?.length && !includesValue(constraints.allowedValues, value)) {
    violations.push({
      code: 'VALUE_NOT_ALLOWED',
      constraint: 'allowedValues',
      message: `is outside the allowed enum (${constraints.allowedValues.join(', ')})`,
    });
  }
  for (const dependency of constraints.dependsOn ?? []) {
    if (context.siblings[dependency] === undefined || context.siblings[dependency] === null) {
      violations.push({
        code: 'DEPENDENCY_MISSING',
        constraint: 'dependsOn',
        message: `requires ${dependency} to also have a value`,
      });
    }
  }
  return violations;
}

function checkNumeric(
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

function checkText(
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

function checkList(
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

function matchesCondition(rule: ConditionalRule, siblings: Record<string, unknown>): boolean {
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

function includesValue(candidates: unknown[], value: unknown): boolean {
  return candidates.some((candidate) => candidate === value || deepEquals(candidate, value));
}

function deepEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || !left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function decimalsOf(value: number): number {
  const text = String(value);
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : text.length - dot - 1;
}

function significantDigits(value: number): number {
  return String(Math.abs(value)).replace(/[.\-]|^0+/g, '').length;
}

function violation(code: string, constraint: string, message: string): ConstraintViolation {
  return { code, constraint, message };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined;
}

function scopedArray(value: unknown): ScopedConstraint[] | undefined {
  return Array.isArray(value) ? (value as ScopedConstraint[]) : undefined;
}
