import { resolvedConstraintsOf, type GeneratorContractVariable } from '../contract-value-factory';
import { round } from './numeric-bounds';

export const NOT_SOLVABLE = Symbol('not-solvable');

export function valueFor(
  operator: string,
  expected: unknown,
  target: boolean,
  differentFrom: (value: unknown) => unknown,
): unknown {
  const number = typeof expected === 'number' ? expected : Number(expected);
  const numeric = Number.isFinite(number);
  const step = Number.isInteger(number) ? 1 : 0.01;

  switch (operator) {
    case 'eq':
    case 'equals':
      return target ? expected : differentFrom(expected);
    case 'neq':
    case 'not_equals':
      return target ? differentFrom(expected) : expected;
    case 'gt':
      if (!numeric) return NOT_SOLVABLE;
      return target ? round(number + step) : number;
    case 'gte':
      if (!numeric) return NOT_SOLVABLE;
      return target ? number : round(number - step);
    case 'lt':
      if (!numeric) return NOT_SOLVABLE;
      return target ? round(number - step) : number;
    case 'lte':
      if (!numeric) return NOT_SOLVABLE;
      return target ? number : round(number + step);
    case 'in':
      if (!Array.isArray(expected) || !expected.length) return NOT_SOLVABLE;
      return target ? expected[0] : differentFrom(expected[0]);
    case 'not_in':
      if (!Array.isArray(expected) || !expected.length) return NOT_SOLVABLE;
      return target ? differentFrom(expected[0]) : expected[0];
    case 'contains':
    case 'starts_with':
    case 'ends_with':
      if (typeof expected !== 'string') return NOT_SOLVABLE;
      if (!target) return differentFrom(expected);
      return operator === 'contains' ? `x${expected}x` : buildAffix(operator, expected);
    default:
      return NOT_SOLVABLE;
  }
}

function buildAffix(operator: string, expected: string): string {
  return operator === 'starts_with' ? `${expected}X` : `X${expected}`;
}

/**
 * Un valor distinto del esperado que el CONTRATO siga aceptando.
 *
 * Con una enumeración cerrada esto importa: para esquivar `kyc_status == REJECTED` hay
 * que elegir otro valor de la lista, no inventar `NO_REJECTED`. Ese invento rompía el
 * contrato, y el caso moría con VARIABLE_MISSING_OR_INVALID sin llegar a la rama que
 * decía probar.
 */
export function differentFrom(
  expected: unknown,
  current: unknown,
  variable: GeneratorContractVariable,
): unknown {
  const allowed = resolvedConstraintsOf(variable).allowedValues;
  const alternative = allowed?.find((candidate) => candidate !== expected);
  if (alternative !== undefined) return alternative;
  if (typeof expected === 'number') return expected + 1;
  if (typeof expected === 'boolean') return !expected;
  if (typeof current === 'string' && current !== expected) return current;
  return `NO_${String(expected)}`;
}
