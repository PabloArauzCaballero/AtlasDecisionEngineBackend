import type { VariableConstraints } from '../../../common/contracts/constraints.types';
import { normalizeDataTypeOrString, type DataType } from '../../../common/contracts/data-types';
import {
  resolvedConstraintsOf,
  satisfiesContract,
  type GeneratorContractVariable,
} from '../contract-value-factory';
import type { SeededRandom } from '../seeded-random';
import { isTextual, listOf, typeMismatchFor } from './helpers';

/**
 * Valor que el contrato DEBE rechazar.
 *
 * También se criba: `min - 1` deja de ser inválido si otra restricción ya admitía ese
 * valor, y proponerlo haría fallar al caso por la razón equivocada.
 */
export function generateInvalidValue(
  variable: GeneratorContractVariable,
  random: SeededRandom,
): { value: unknown; mutation: string } | null {
  const type = normalizeDataTypeOrString(variable.dataType);
  const constraints = resolvedConstraintsOf(variable);
  const candidates = invalidCandidates(type, constraints);
  const rejected = candidates.filter((candidate) => !satisfiesContract(variable, candidate.value));
  return rejected.length ? random.pick(rejected) : null;
}

function invalidCandidates(
  type: DataType,
  constraints: VariableConstraints,
): Array<{ value: unknown; mutation: string }> {
  const candidates: Array<{ value: unknown; mutation: string }> = [];

  if (constraints.min !== undefined) {
    candidates.push({ value: constraints.min - 1, mutation: 'justo por debajo del mínimo' });
  }
  if (constraints.max !== undefined) {
    candidates.push({ value: constraints.max + 1, mutation: 'justo por encima del máximo' });
  }
  if (constraints.exclusiveMin !== undefined) {
    candidates.push({ value: constraints.exclusiveMin, mutation: 'igual al límite abierto' });
  }
  if (constraints.exclusiveMax !== undefined) {
    candidates.push({ value: constraints.exclusiveMax, mutation: 'igual al límite abierto' });
  }
  if (constraints.minLength !== undefined && isTextual(type) && constraints.minLength > 0) {
    candidates.push({ value: '', mutation: 'texto vacío' });
  }
  if (constraints.maxLength !== undefined && isTextual(type)) {
    candidates.push({
      value: 'a'.repeat(constraints.maxLength + 1),
      mutation: 'texto excesivamente largo',
    });
  }
  if (constraints.allowedValues?.length) {
    // Un valor PARECIDO a los admitidos, no un marcador: `APROBADO_X` o `aprobado` ponen a
    // prueba la comparación exacta, que es donde falla de verdad una enumeración
    // (mayúsculas, sufijos), y se leen en el informe como un dato y no como basura.
    const first = String(constraints.allowedValues[0]);
    const lower = first.toLowerCase();
    if (lower !== first)
      candidates.push({ value: lower, mutation: 'valor fuera de la enumeración (minúsculas)' });
    candidates.push({ value: `${first}_X`, mutation: 'valor fuera de la enumeración' });
  }
  if (constraints.maxItems !== undefined && type === 'LIST') {
    candidates.push({
      value: listOf(constraints.maxItems + 1),
      mutation: 'lista con exceso de elementos',
    });
  }
  if (type === 'LIST' && (constraints.minItems ?? 0) > 0) {
    candidates.push({ value: [], mutation: 'lista vacía' });
  }
  if (type === 'LIST' && constraints.unique) {
    candidates.push({ value: [1, 1], mutation: 'lista con elementos repetidos' });
  }
  if (constraints.pattern) {
    candidates.push({ value: '###patrón-inválido###', mutation: 'no cumple el patrón' });
  }
  if (constraints.format) {
    candidates.push({ value: 'no-cumple-el-formato', mutation: `formato ${constraints.format}` });
  }
  if (constraints.precision !== undefined) {
    candidates.push({
      value: 10 ** (constraints.precision + 1),
      mutation: 'más dígitos de los admitidos',
    });
  }
  if (constraints.scale !== undefined) {
    candidates.push({
      value: 1 + 10 ** -(constraints.scale + 1),
      mutation: 'más decimales de los admitidos',
    });
  }
  if (type === 'PERCENTAGE') {
    candidates.push({ value: 120, mutation: 'porcentaje fuera de rango' });
  }
  // Tipo incorrecto: siempre disponible, cualquiera que sea el contrato.
  candidates.push({ value: typeMismatchFor(type), mutation: 'tipo incorrecto' });
  return candidates;
}
