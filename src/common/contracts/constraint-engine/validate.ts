import {
  checkTypeShape,
  normalizeDataTypeOrString,
  NUMERIC_TYPES,
  type DataType,
} from '../data-types';
import type {
  ConstraintContext,
  ConstraintViolation,
  VariableConstraints,
} from '../constraints.types';
import { EMPTY_CONTEXT } from '../constraints.types';
import { checkList, checkNumeric, checkText } from './checks';
import { includesValue } from './conditions-and-helpers';
import { resolveConstraints } from './parse-and-resolve';

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
