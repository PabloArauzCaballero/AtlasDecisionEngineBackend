/**
 * Generación de casos guiada por el contrato (§10.3).
 *
 * El generador LEE el contrato de variables y produce por sí solo valores válidos, no
 * válidos y de frontera. No hay listas de casos escritas a mano: si mañana alguien
 * añade una restricción `maxLength`, los casos "justo por encima del máximo" aparecen
 * solos. Esa es la diferencia entre un banco de pruebas que envejece y uno que sigue
 * al contrato.
 *
 * ## Los tres tipos de caso tienen que ser verdad
 *
 * Un VÁLIDO que el contrato rechaza, o un FRONTERA que se sale del rango, llenan el
 * informe de fallos que no son fallos y queman la confianza en el QA Lab. Por eso los
 * candidatos de frontera y de inválido se CRIBAN con el mismo juez que ejecutará después
 * (`validateAgainstConstraints`): sobrevive el que de verdad es lo que dice ser. Antes se
 * elegían a ciegas y, por ejemplo, un porcentaje acotado a 20–80 recibía el «límite» 0.
 *
 * La construcción de un valor válido vive en `contract-value-factory.ts`.
 */
import type { VariableConstraints } from '../../common/contracts/constraints.types';
import { normalizeDataTypeOrString, type DataType } from '../../common/contracts/data-types';
import {
  buildValidValue,
  resolvedConstraintsOf,
  satisfiesContract,
  type DistributionMap,
  type GeneratorContractVariable,
  type VariableDistribution,
} from './contract-value-factory';
import { sampleForPattern } from './pattern-samples';
import type { SeededRandom } from './seeded-random';

export type {
  DistributionMap,
  GeneratorContractVariable,
  VariableDistribution,
} from './contract-value-factory';

/** Clase de caso generado. Determina qué se espera de la ejecución. */
export type CaseKind = 'VALID' | 'BOUNDARY' | 'INVALID';

export interface GeneratedCase {
  index: number;
  kind: CaseKind;
  /** Qué se manipuló para hacerlo inválido/frontera, para el informe. */
  mutation?: string;
  input: Record<string, unknown>;
  /**
   * Códigos cuyo contrato es contradictorio y para los que NINGÚN valor es válido
   * (`format: EMAIL` con `maxLength: 4`, `min` mayor que `max`…). Se declara en vez de
   * silenciarse: el caso se entrega igual, pero quien lo lea sabe que ese campo no
   * describe una entrada legítima y que lo que hay que arreglar es el contrato.
   */
  unsatisfiable?: string[];
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
  return buildValidValue(variable, random, distribution).value;
}

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
    candidates.push({ value: '__NO_ENUMERADO__', mutation: 'valor fuera de la enumeración' });
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
    const unsatisfiable: string[] = [];
    for (const variable of inputs) {
      // Una entrada opcional se omite de vez en cuando: probar solo payloads completos
      // deja sin cubrir justo la rama de valores por defecto.
      if (!variable.required && random.bool(0.25)) continue;
      const generated = buildValidValue(variable, random, distributions[variable.code]);
      input[variable.code] = generated.value;
      if (!generated.satisfied) unsatisfiable.push(variable.code);
    }
    const notes = unsatisfiable.length ? { unsatisfiable } : {};
    if (kind === 'VALID' || !inputs.length) return { index, kind, input, ...notes };

    const target = random.pick(inputs);
    const mutated =
      kind === 'BOUNDARY'
        ? generateBoundaryValue(target, random)
        : generateInvalidValue(target, random);
    // Sin borde ni valor rechazable, este contrato no admite la clase pedida: se entrega
    // como VÁLIDO en vez de fingir una mutación que no ocurrió.
    if (!mutated) return { index, kind: 'VALID', input, ...notes };
    input[target.code] = mutated.value;
    return { index, kind, mutation: `${target.code}: ${mutated.mutation}`, input, ...notes };
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

function isTextual(type: DataType): boolean {
  return ['STRING', 'LONG_TEXT', 'CODE', 'IDENTIFIER', 'ENUM'].includes(type);
}

function listOf(size: number): number[] {
  return Array.from({ length: Math.max(0, size) }, (_, index) => index);
}

/** Corta la basura binaria de la aritmética flotante al proponer un borde. */
function round(value: number): number {
  return Number(value.toFixed(10));
}

/** Un valor de otro tipo, garantizado incompatible con `type`. */
function typeMismatchFor(type: DataType): unknown {
  if (['INTEGER', 'DECIMAL', 'PERCENTAGE', 'CURRENCY'].includes(type)) return 'no-soy-un-numero';
  if (type === 'BOOLEAN') return 'quizá';
  if (type === 'LIST') return { noSoy: 'una lista' };
  if (type === 'OBJECT' || type === 'STRUCTURED_RESULT') return ['no', 'soy', 'un', 'objeto'];
  return 12345;
}
