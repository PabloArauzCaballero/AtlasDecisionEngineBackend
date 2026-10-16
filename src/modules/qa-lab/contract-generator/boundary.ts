import type { VariableConstraints } from '../../../common/contracts/constraints.types';
import { normalizeDataTypeOrString, type DataType } from '../../../common/contracts/data-types';
import {
  resolvedConstraintsOf,
  satisfiesContract,
  type GeneratorContractVariable,
} from '../contract-value-factory';
import { sampleForPattern } from '../pattern-samples';
import type { SeededRandom } from '../seeded-random';
import { isTextual, listOf, round } from './helpers';

/**
 * Valor exactamente en el borde permitido: el caso que más fallos destapa.
 *
 * Todo candidato pasa por el contrato antes de entrar en el sorteo. Un borde derivado de
 * una restricción no vale si otra lo prohíbe —el mínimo de un rango que además tiene
 * enumeración cerrada, o el 0 de un porcentaje acotado a 20–80— y devolverlo convertía un
 * caso «frontera» en un caso inválido mal etiquetado.
 */
export function generateBoundaryValue(
  variable: GeneratorContractVariable,
  random: SeededRandom,
): { value: unknown; mutation: string } | null {
  const type = normalizeDataTypeOrString(variable.dataType);
  const constraints = resolvedConstraintsOf(variable);
  const feasible = boundaryCandidates(type, constraints, random).filter((candidate) =>
    satisfiesContract(variable, candidate.value),
  );
  return feasible.length ? random.pick(feasible) : null;
}

function boundaryCandidates(
  type: DataType,
  constraints: VariableConstraints,
  random: SeededRandom,
): Array<{ value: unknown; mutation: string }> {
  const candidates: Array<{ value: unknown; mutation: string }> = [];
  const step = 10 ** -(constraints.scale ?? (type === 'INTEGER' ? 0 : 2));

  if (constraints.min !== undefined) {
    candidates.push({ value: constraints.min, mutation: 'min exacto' });
  }
  if (constraints.max !== undefined) {
    candidates.push({ value: constraints.max, mutation: 'max exacto' });
  }
  // El primer valor representable dentro de un límite abierto: el borde real de la regla.
  if (constraints.exclusiveMin !== undefined) {
    candidates.push({
      value: round(constraints.exclusiveMin + step),
      mutation: 'justo dentro del límite abierto inferior',
    });
  }
  if (constraints.exclusiveMax !== undefined) {
    candidates.push({
      value: round(constraints.exclusiveMax - step),
      mutation: 'justo dentro del límite abierto superior',
    });
  }
  if (isTextual(type)) {
    candidates.push(...textBoundaries(constraints, random));
  }
  if (type === 'LIST') {
    if (constraints.minItems !== undefined) {
      candidates.push({
        value: listOf(constraints.minItems),
        mutation: 'lista con el mínimo de elementos',
      });
    }
    if (constraints.maxItems !== undefined) {
      candidates.push({
        value: listOf(constraints.maxItems),
        mutation: 'lista con el máximo de elementos',
      });
    }
  }
  if (constraints.allowedValues?.length) {
    candidates.push({
      value: constraints.allowedValues[0],
      mutation: 'primer valor de la enumeración',
    });
    candidates.push({
      value: constraints.allowedValues[constraints.allowedValues.length - 1],
      mutation: 'último valor de la enumeración',
    });
  }
  if (type === 'PERCENTAGE') {
    candidates.push(
      { value: 0, mutation: 'porcentaje 0' },
      { value: 100, mutation: 'porcentaje 100' },
    );
  }
  return candidates;
}

/**
 * Bordes de longitud. Cuando hay `pattern`, la cadena de relleno `aaa…` casi nunca casa,
 * así que se pide al muestreador de patrones una cadena de esa longitud exacta; si no la
 * consigue, no se propone el candidato en lugar de proponer uno inválido.
 */
function textBoundaries(
  constraints: VariableConstraints,
  random: SeededRandom,
): Array<{ value: unknown; mutation: string }> {
  const bounds: Array<[number | undefined, string]> = [
    [constraints.minLength, 'longitud mínima'],
    [constraints.maxLength, 'longitud máxima'],
  ];
  const candidates: Array<{ value: unknown; mutation: string }> = [];
  for (const [length, mutation] of bounds) {
    if (length === undefined) continue;
    const value = constraints.pattern
      ? sampleForPattern(constraints.pattern, random, (candidate) => candidate.length === length)
      : 'a'.repeat(length);
    if (value !== null) candidates.push({ value, mutation });
  }
  return candidates;
}
