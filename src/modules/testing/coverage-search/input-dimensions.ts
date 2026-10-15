import {
  buildValidValue,
  satisfiesContract,
  type GeneratorContractVariable,
} from '../../qa-lab/contract-value-factory';
import { generateBoundaryValue } from '../../qa-lab/contract-generator';
import type { SeededRandom } from '../../qa-lab/seeded-random';
import {
  ABSENT,
  candidateValues,
  distinct,
  isBoolean,
  isInteger,
  isNumeric,
} from './candidate-values';
import type { Dimension } from './types';

export function inputDimension(
  variable: GeneratorContractVariable,
  literals: unknown[],
  base: unknown,
  random: SeededRandom,
): Dimension {
  const boundary = generateBoundaryValue(variable, random);
  const accepts = (value: unknown) =>
    value === ABSENT
      ? !variable.required
      : value === null
        ? variable.nullable
        : satisfiesContract(variable, value);
  const values = candidateValues(
    variable.dataType,
    literals,
    boundary ? [base, boundary.value] : [base],
  );
  // Una opcional también se prueba AUSENTE: las ramas de `coalesce` y de «no vino el dato».
  values.push(ABSENT, null);
  return {
    key: variable.code,
    values: distinct(values.filter(accepts)),
    numeric: isNumeric(variable.dataType),
    integer: isInteger(variable.dataType),
    accepts,
    read: (candidate) =>
      variable.code in candidate.variables ? candidate.variables[variable.code] : ABSENT,
    apply: (candidate, value) => {
      if (value === ABSENT) delete candidate.variables[variable.code];
      else candidate.variables[variable.code] = value;
    },
  };
}

/**
 * Un valor de partida «tranquilo»: cero, falso, lo más corriente que el contrato acepte.
 *
 * Un valor válido al azar puede ser 8.000 consultas o 90 millones de saldo: la entrada base caía
 * siempre en el extremo del grafo, y llegar desde ahí a la rama corriente costaba decenas de pasos.
 */
export function calmValue(variable: GeneratorContractVariable, random: SeededRandom): unknown {
  const candidates: unknown[] = isBoolean(variable.dataType)
    ? [false]
    : isNumeric(variable.dataType)
      ? [0, 1]
      : [];
  const calm = candidates.find((value) => satisfiesContract(variable, value));
  return calm !== undefined ? calm : buildValidValue(variable, random).value;
}
