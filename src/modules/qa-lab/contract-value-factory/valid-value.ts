import {
  parseConstraints,
  resolveConstraints,
  validateAgainstConstraints,
} from '../../../common/contracts/constraint-engine';
import type { VariableConstraints } from '../../../common/contracts/constraints.types';
import { normalizeDataTypeOrString, type DataType } from '../../../common/contracts/data-types';
import { documentSampleValue } from '../document-samples';
import type { DistributionShape, SeededRandom } from '../seeded-random';
import { booleanProbability, listValue, pad, repairCandidates, weightFor } from './list-values';
import { textValue } from './text-values';
import { GeneratorContractVariable, ValidValueResult, VariableDistribution } from './types';

/** Intentos de generación antes de pasar a la reparación derivada del contrato. */
const GENERATION_ATTEMPTS = 4;
/** Longitud por defecto de un texto sin `minLength` declarado. */
export const DEFAULT_MIN_LENGTH = 3;
/** Techo de longitud para un texto sin `maxLength`: un caso de prueba debe ser legible. */
export const DEFAULT_MAX_LENGTH = 64;

export function resolvedConstraintsOf(variable: GeneratorContractVariable): VariableConstraints {
  return resolveConstraints(parseConstraints(variable.constraints), { siblings: {} });
}

/** ¿Acepta el contrato este valor? Mismo juez que usará la ejecución. */
export function satisfiesContract(variable: GeneratorContractVariable, value: unknown): boolean {
  return (
    validateAgainstConstraints(variable.dataType, parseConstraints(variable.constraints), value)
      .length === 0
  );
}

/**
 * Un valor válido para la variable, respetando TODAS sus restricciones.
 *
 * Los documentos son la única excepción declarada al juicio final: para el contrato
 * `extracto_pdf_base64` es un `STRING` cualquiera, pero rellenarlo con letras al azar
 * produce un caso inejecutable. Se antepone el documento sintético aunque su longitud
 * desborde un `maxLength` mal declarado, porque un PDF recortado no es un PDF.
 */
export function buildValidValue(
  variable: GeneratorContractVariable,
  random: SeededRandom,
  distribution?: VariableDistribution,
): ValidValueResult {
  const document = documentSampleValue(variable.code, variable.dataType);
  if (document !== null) return { value: document, satisfied: true };

  const type = normalizeDataTypeOrString(variable.dataType);
  const constraints = resolvedConstraintsOf(variable);

  let last: unknown;
  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    last = composeValue(type, constraints, random, distribution);
    if (satisfiesContract(variable, last)) return { value: last, satisfied: true };
  }

  for (const candidate of repairCandidates(type, constraints)) {
    if (satisfiesContract(variable, candidate)) return { value: candidate, satisfied: true };
  }
  return { value: last, satisfied: false };
}

function composeValue(
  type: DataType,
  constraints: VariableConstraints,
  random: SeededRandom,
  distribution?: VariableDistribution,
): unknown {
  if (constraints.allowedValues?.length) {
    return distribution?.valueWeights
      ? random.pickWeighted(constraints.allowedValues, (value) => weightFor(distribution, value))
      : random.pick(constraints.allowedValues);
  }

  const shape = distribution?.shape;
  switch (type) {
    case 'INTEGER':
      return integerValue(constraints, random, shape);
    case 'DECIMAL':
    case 'CURRENCY':
    case 'PERCENTAGE':
      return decimalValue(type, constraints, random, shape);
    case 'BOOLEAN':
      // Un booleano no tiene rango que deformar, pero sí proporción: el peso de `true`
      // frente al de `false` es exactamente lo que se quiere sesgar.
      return random.bool(booleanProbability(distribution));
    case 'DATE':
      return random.isoDate();
    case 'DATETIME':
      return `${random.isoDate()}T${pad(random.int(0, 23))}:${pad(random.int(0, 59))}:00Z`;
    case 'TIME':
      return `${pad(random.int(0, 23))}:${pad(random.int(0, 59))}`;
    case 'LIST':
      return listValue(constraints, random);
    case 'OBJECT':
    case 'STRUCTURED_RESULT':
      return { valor: random.int(1, 100) };
    default:
      return textValue(type, constraints, random);
  }
}

/* ------------------------------------------------------------------ numéricos */

/**
 * Rango efectivo de un numérico: mezcla `min`/`max`, los límites exclusivos convertidos
 * al primer valor representable con la escala declarada, el techo que impone `precision`
 * y el rango natural del tipo.
 */
export function numericRange(
  type: DataType,
  constraints: VariableConstraints,
  scale: number,
): [number, number] {
  const step = 10 ** -scale;
  let min = constraints.min ?? -(10 ** 6);
  let max = constraints.max ?? 10 ** 6;
  if (constraints.exclusiveMin !== undefined) min = Math.max(min, constraints.exclusiveMin + step);
  if (constraints.exclusiveMax !== undefined) max = Math.min(max, constraints.exclusiveMax - step);

  if (constraints.precision !== undefined) {
    // `significantDigits` cuenta los dígitos sin el separador decimal: con precisión 4 y
    // escala 2 el mayor admitido es 99,99, no 9999.
    const limit = 10 ** (constraints.precision - scale) - step;
    min = Math.max(min, -limit);
    max = Math.min(max, limit);
  }
  // Un porcentaje fuera de [0,100] lo rechaza ya la forma del tipo.
  if (type === 'PERCENTAGE') {
    min = Math.max(min, 0);
    max = Math.min(max, 100);
  }
  // Sin restricciones declaradas se mantiene el rango amable de siempre.
  if (constraints.min === undefined && constraints.exclusiveMin === undefined && min < 0) {
    min = 0;
  }
  if (constraints.max === undefined && constraints.exclusiveMax === undefined) {
    max = Math.min(max, type === 'INTEGER' ? 1_000 : type === 'PERCENTAGE' ? 100 : 10_000);
  }
  return [min, max];
}

function integerValue(
  constraints: VariableConstraints,
  random: SeededRandom,
  shape?: DistributionShape,
): number {
  const [min, max] = numericRange('INTEGER', constraints, 0);
  const lower = Math.ceil(min);
  const upper = Math.floor(max);
  return upper < lower ? lower : random.int(lower, upper, shape);
}

function decimalValue(
  type: DataType,
  constraints: VariableConstraints,
  random: SeededRandom,
  shape?: DistributionShape,
): number {
  const scale = constraints.scale ?? 2;
  const [min, max] = numericRange(type, constraints, scale);
  const factor = 10 ** scale;
  // Se acotan los extremos ANTES de sortear: `random.float` redondea al final, y redondear
  // un valor pegado al borde lo empujaba fuera del rango (por debajo de `min` con escala 0,
  // o justo sobre un `exclusiveMax`).
  const lower = Math.ceil(min * factor) / factor;
  const upper = Math.floor(max * factor) / factor;
  if (upper < lower) return roundTo(lower, scale);
  const drawn = random.float(lower, upper, scale, shape);
  return roundTo(Math.min(upper, Math.max(lower, drawn)), scale);
}

/** Redondeo estable a `scale` decimales: `toFixed` evita los 0,30000000000000004. */
export function roundTo(value: number, scale: number): number {
  return Number(value.toFixed(Math.max(0, Math.min(scale, 15))));
}

/* ---------------------------------------------------------------------- texto */
