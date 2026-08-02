/**
 * Generación de casos guiada por el contrato (§10.3).
 *
 * El generador LEE el contrato de variables y produce por sí solo valores válidos, no
 * válidos y de frontera. No hay listas de casos escritas a mano: si mañana alguien
 * añade una restricción `maxLength`, los casos "justo por encima del máximo" aparecen
 * solos. Esa es la diferencia entre un banco de pruebas que envejece y uno que sigue
 * al contrato.
 */
import { parseConstraints, resolveConstraints } from '../../common/contracts/constraint-engine';
import { normalizeDataTypeOrString, type DataType } from '../../common/contracts/data-types';
import type { VariableConstraints } from '../../common/contracts/constraints.types';
import type { DistributionShape, SeededRandom } from './seeded-random';

/**
 * Cómo se reparten los valores de UNA variable dentro de su rango (§10.4).
 *
 * Sin esto el generador reparte uniformemente, que es justo lo que infrarrepresenta los
 * casos que más interesan: si el 3 % de la cartera real cobra el mínimo, un lote uniforme
 * apenas roza ese tramo y la política que lo rechaza mal se publica sin haberse probado.
 * La distribución NO relaja el contrato: sesga dónde caen los valores, nunca genera uno
 * que las restricciones prohíban.
 */
export interface VariableDistribution {
  shape?: DistributionShape;
  /** Pesos relativos por valor, solo para variables con enumeración cerrada. */
  valueWeights?: Record<string, number>;
}

export type DistributionMap = Readonly<Record<string, VariableDistribution>>;

/** Peso declarado para un valor concreto de una enumeración; 1 cuando no se declaró. */
function weightFor(distribution: VariableDistribution | undefined, value: unknown): number {
  const weights = distribution?.valueWeights;
  if (!weights) return 1;
  const declared = weights[String(value)];
  return declared === undefined ? 1 : declared;
}

/** Clase de caso generado. Determina qué se espera de la ejecución. */
export type CaseKind = 'VALID' | 'BOUNDARY' | 'INVALID';

export interface GeneratedCase {
  index: number;
  kind: CaseKind;
  /** Qué se manipuló para hacerlo inválido/frontera, para el informe. */
  mutation?: string;
  input: Record<string, unknown>;
}

export interface GeneratorContractVariable {
  code: string;
  dataType: string;
  required: boolean;
  nullable: boolean;
  defaultValue?: unknown;
  constraints?: unknown;
}

export interface GenerationMix {
  /** Porcentajes; se normalizan si no suman 100. */
  validPercent: number;
  invalidPercent: number;
  boundaryPercent: number;
}

/** Un valor válido para la variable, respetando todas sus restricciones. */
export function generateValidValue(
  variable: GeneratorContractVariable,
  random: SeededRandom,
  distribution?: VariableDistribution,
): unknown {
  const type = normalizeDataTypeOrString(variable.dataType);
  const constraints = resolveConstraints(parseConstraints(variable.constraints), { siblings: {} });
  const shape = distribution?.shape;
  if (constraints.allowedValues?.length) {
    return distribution?.valueWeights
      ? random.pickWeighted(constraints.allowedValues, (value) => weightFor(distribution, value))
      : random.pick(constraints.allowedValues);
  }

  switch (type) {
    case 'INTEGER': {
      const [min, max] = numericBounds(constraints, 0, 1_000, true);
      return random.int(Math.ceil(min), Math.floor(max), shape);
    }
    case 'DECIMAL':
    case 'CURRENCY': {
      const [min, max] = numericBounds(constraints, 0, 10_000, false);
      return random.float(min, max, constraints.scale ?? 2, shape);
    }
    case 'PERCENTAGE': {
      const [min, max] = numericBounds(constraints, 0, 100, false);
      return random.float(Math.max(0, min), Math.min(100, max), constraints.scale ?? 2, shape);
    }
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
    case 'LIST': {
      const size = random.int(constraints.minItems ?? 1, Math.min(constraints.maxItems ?? 3, 5));
      return Array.from({ length: size }, (_, index) => index + 1);
    }
    case 'OBJECT':
    case 'STRUCTURED_RESULT':
      return { valor: random.int(1, 100) };
    default: {
      const min = constraints.minLength ?? 3;
      const max = Math.min(constraints.maxLength ?? Math.max(min + 5, 12), 64);
      return textFor(type, random, min, Math.max(min, max), constraints);
    }
  }
}

/** Valor exactamente en el borde permitido: el caso que más fallos destapa. */
export function generateBoundaryValue(
  variable: GeneratorContractVariable,
  random: SeededRandom,
): { value: unknown; mutation: string } | null {
  const type = normalizeDataTypeOrString(variable.dataType);
  const constraints = resolveConstraints(parseConstraints(variable.constraints), { siblings: {} });
  const candidates: Array<{ value: unknown; mutation: string }> = [];

  if (constraints.min !== undefined)
    candidates.push({ value: constraints.min, mutation: 'min exacto' });
  if (constraints.max !== undefined)
    candidates.push({ value: constraints.max, mutation: 'max exacto' });
  if (constraints.minLength !== undefined && isTextual(type)) {
    candidates.push({ value: 'a'.repeat(constraints.minLength), mutation: 'longitud mínima' });
  }
  if (constraints.maxLength !== undefined && isTextual(type)) {
    candidates.push({ value: 'a'.repeat(constraints.maxLength), mutation: 'longitud máxima' });
  }
  if (constraints.minItems !== undefined && type === 'LIST') {
    candidates.push({
      value: Array.from({ length: constraints.minItems }, (_, index) => index),
      mutation: 'lista con el mínimo de elementos',
    });
  }
  if (constraints.maxItems !== undefined && type === 'LIST') {
    candidates.push({
      value: Array.from({ length: constraints.maxItems }, (_, index) => index),
      mutation: 'lista con el máximo de elementos',
    });
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
  return candidates.length ? random.pick(candidates) : null;
}

/** Valor que el contrato DEBE rechazar. */
export function generateInvalidValue(
  variable: GeneratorContractVariable,
  random: SeededRandom,
): { value: unknown; mutation: string } | null {
  const type = normalizeDataTypeOrString(variable.dataType);
  const constraints = resolveConstraints(parseConstraints(variable.constraints), { siblings: {} });
  const candidates: Array<{ value: unknown; mutation: string }> = [];

  if (constraints.min !== undefined) {
    candidates.push({ value: constraints.min - 1, mutation: 'justo por debajo del mínimo' });
  }
  if (constraints.max !== undefined) {
    candidates.push({ value: constraints.max + 1, mutation: 'justo por encima del máximo' });
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
    candidates.push({ value: '__NO_ENUMERADO__', mutation: 'valor fuera de la enumeración' });
  }
  if (constraints.maxItems !== undefined && type === 'LIST') {
    candidates.push({
      value: Array.from({ length: constraints.maxItems + 1 }, (_, index) => index),
      mutation: 'lista con exceso de elementos',
    });
  }
  if (type === 'LIST' && (constraints.minItems ?? 0) > 0) {
    candidates.push({ value: [], mutation: 'lista vacía' });
  }
  if (constraints.pattern) {
    candidates.push({ value: '###patrón-inválido###', mutation: 'no cumple el patrón' });
  }
  if (type === 'PERCENTAGE') {
    candidates.push({ value: 120, mutation: 'porcentaje fuera de rango' });
  }
  // Tipo incorrecto: siempre disponible, cualquiera que sea el contrato.
  candidates.push({ value: typeMismatchFor(type), mutation: 'tipo incorrecto' });
  return random.pick(candidates);
}

/** Construye un lote determinista de casos a partir del contrato de entradas. */
export function generateCases(
  variables: GeneratorContractVariable[],
  random: SeededRandom,
  total: number,
  mix: GenerationMix,
  distributions: DistributionMap = {},
): GeneratedCase[] {
  const kinds = distribute(total, mix);
  const inputs = variables.filter((variable) => variable.code);
  return kinds.map((kind, index) => {
    const input: Record<string, unknown> = {};
    for (const variable of inputs) {
      // Una entrada opcional se omite de vez en cuando: probar solo payloads completos
      // deja sin cubrir justo la rama de valores por defecto.
      if (!variable.required && random.bool(0.25)) continue;
      input[variable.code] = generateValidValue(variable, random, distributions[variable.code]);
    }
    if (kind === 'VALID' || !inputs.length) return { index, kind, input };

    const target = random.pick(inputs);
    const mutated =
      kind === 'BOUNDARY'
        ? generateBoundaryValue(target, random)
        : generateInvalidValue(target, random);
    if (!mutated) return { index, kind: 'VALID', input };
    input[target.code] = mutated.value;
    return { index, kind, mutation: `${target.code}: ${mutated.mutation}`, input };
  });
}

/** Reparte `total` casos según la mezcla configurada, sin perder ni inventar casos. */
export function distribute(total: number, mix: GenerationMix): CaseKind[] {
  const weights = [
    Math.max(0, mix.validPercent),
    Math.max(0, mix.boundaryPercent),
    Math.max(0, mix.invalidPercent),
  ];
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const counts = weights.map((weight) => Math.floor((weight / sum) * total));
  // El reparto entero puede dejar casos sin asignar; van a la clase mayoritaria para
  // que el total pedido siempre coincida con el total ejecutado.
  let remainder = total - counts.reduce((a, b) => a + b, 0);
  const dominant = counts.indexOf(Math.max(...counts));
  counts[dominant] += remainder > 0 ? remainder : 0;
  remainder = total - counts.reduce((a, b) => a + b, 0);
  if (remainder > 0) counts[0] += remainder;

  const kinds: CaseKind[] = [];
  const order: CaseKind[] = ['VALID', 'BOUNDARY', 'INVALID'];
  counts.forEach((count, position) => {
    for (let index = 0; index < count; index += 1) kinds.push(order[position]);
  });
  return kinds.slice(0, total);
}

function numericBounds(
  constraints: VariableConstraints,
  fallbackMin: number,
  fallbackMax: number,
  integer: boolean,
): [number, number] {
  const min =
    constraints.min ??
    (constraints.exclusiveMin !== undefined
      ? constraints.exclusiveMin + (integer ? 1 : 0.01)
      : fallbackMin);
  const max =
    constraints.max ??
    (constraints.exclusiveMax !== undefined
      ? constraints.exclusiveMax - (integer ? 1 : 0.01)
      : fallbackMax);
  return max < min ? [min, min] : [min, max];
}

/**
 * Proporción de `true` para un booleano sesgado. Se deriva de los mismos `valueWeights`
 * que las enumeraciones para no inventar una segunda forma de decir lo mismo.
 */
function booleanProbability(distribution: VariableDistribution | undefined): number {
  const weights = distribution?.valueWeights;
  if (!weights) return 0.5;
  const positive = Math.max(0, Number(weights.true ?? weights.TRUE ?? 1));
  const negative = Math.max(0, Number(weights.false ?? weights.FALSE ?? 1));
  const total = positive + negative;
  return total > 0 ? positive / total : 0.5;
}

function isTextual(type: DataType): boolean {
  return ['STRING', 'LONG_TEXT', 'CODE', 'IDENTIFIER', 'ENUM'].includes(type);
}

function textFor(
  type: DataType,
  random: SeededRandom,
  min: number,
  max: number,
  constraints: VariableConstraints,
): string {
  const length = random.int(min, max);
  if (constraints.format === 'EMAIL') return `${random.string(6)}@ejemplo.test`;
  if (constraints.format === 'ISO_COUNTRY') return random.pick(['BO', 'PE', 'CL', 'AR', 'MX']);
  if (constraints.format === 'ISO_CURRENCY') return random.pick(['BOB', 'USD', 'PEN', 'CLP']);
  if (type === 'IDENTIFIER') return random.string(Math.max(8, length), 'ABCDEF0123456789');
  if (type === 'CODE') return random.string(Math.max(3, length), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_');
  return random.string(Math.max(1, length));
}

/** Un valor de otro tipo, garantizado incompatible con `type`. */
function typeMismatchFor(type: DataType): unknown {
  if (['INTEGER', 'DECIMAL', 'PERCENTAGE', 'CURRENCY'].includes(type)) return 'no-soy-un-numero';
  if (type === 'BOOLEAN') return 'quizá';
  if (type === 'LIST') return { noSoy: 'una lista' };
  if (type === 'OBJECT' || type === 'STRUCTURED_RESULT') return ['no', 'soy', 'un', 'objeto'];
  return 12345;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
