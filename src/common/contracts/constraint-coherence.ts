/**
 * Restricciones que se contradicen entre sí y harían imposible cualquier valor.
 *
 * Vive aquí, y no dentro de `VariableContractService`, porque hacen falta en dos
 * momentos distintos: al declarar una variable (§1.2) y al validar el artefacto
 * que la usa como entrada, antes de publicarlo. Duplicar la regla sería aceptar
 * que un contrato imposible pase por un camino y no por el otro.
 */
import type { VariableConstraints } from './constraints.types';

export interface ConstraintCoherenceIssue {
  code: string;
  message: string;
}

export function checkConstraintCoherence(
  constraints: VariableConstraints,
): ConstraintCoherenceIssue[] {
  const issues: ConstraintCoherenceIssue[] = [];
  const pair = (min: number | undefined, max: number | undefined, code: string, label: string) => {
    if (min !== undefined && max !== undefined && min > max) {
      issues.push({ code, message: `${label}: el mínimo (${min}) supera al máximo (${max})` });
    }
  };
  pair(constraints.min, constraints.max, 'RANGE_INVERTED', 'Rango');
  pair(constraints.minLength, constraints.maxLength, 'LENGTH_INVERTED', 'Longitud');
  pair(constraints.minItems, constraints.maxItems, 'ITEMS_INVERTED', 'Cardinalidad');

  if (constraints.scale !== undefined && constraints.precision !== undefined) {
    if (constraints.scale > constraints.precision) {
      issues.push({
        code: 'SCALE_ABOVE_PRECISION',
        message: `La escala (${constraints.scale}) no puede superar la precisión (${constraints.precision})`,
      });
    }
  }
  if (constraints.pattern) {
    try {
      new RegExp(constraints.pattern);
    } catch {
      issues.push({ code: 'PATTERN_INVALID', message: 'La expresión regular no compila' });
    }
  }
  if (constraints.allowedValues?.length === 0) {
    issues.push({
      code: 'ALLOWED_VALUES_EMPTY',
      message: 'La lista de valores permitidos está vacía: ningún valor sería válido',
    });
  }
  return issues;
}
