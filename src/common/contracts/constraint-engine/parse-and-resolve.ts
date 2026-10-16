import { normalizeDataTypeOrString } from '../data-types';
import type {
  ConditionalRule,
  ConstraintContext,
  ScopedConstraint,
  VariableConstraints,
} from '../constraints.types';
import { EMPTY_CONTEXT } from '../constraints.types';
import {
  matchesCondition,
  numberOrUndefined,
  scopedArray,
  stringArray,
} from './conditions-and-helpers';

export const FORMAT_PATTERNS: Readonly<Record<string, RegExp>> = {
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
