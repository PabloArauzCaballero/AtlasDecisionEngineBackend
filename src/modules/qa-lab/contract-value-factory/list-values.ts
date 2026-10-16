import type { VariableConstraints } from '../../../common/contracts/constraints.types';
import { type DataType } from '../../../common/contracts/data-types';
import type { SeededRandom } from '../seeded-random';
import { alphabetFor } from './text-values';
import { VariableDistribution } from './types';
import { numericRange, roundTo } from './valid-value';

export function listValue(constraints: VariableConstraints, random: SeededRandom): unknown[] {
  const ceiling = constraints.maxItems ?? Number.MAX_SAFE_INTEGER;
  const lower = Math.max(0, Math.min(constraints.minItems ?? 1, ceiling));
  const upper = Math.max(lower, Math.min(constraints.maxItems ?? Math.max(lower + 2, 3), 10));
  const size = random.int(lower, upper);
  const itemType = constraints.itemType ?? 'INTEGER';

  const items: unknown[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < size; index += 1) {
    let item = itemSample(itemType, index, random);
    // `unique` obliga a que los elementos sean distintos; el índice ya los separa para los
    // tipos derivados de él, pero un booleano o una enumeración corta pueden repetirse.
    for (let retry = 0; constraints.unique && seen.has(stableKey(item)) && retry < 8; retry += 1) {
      item = itemSample(itemType, index + (retry + 1) * 97, random);
    }
    seen.add(stableKey(item));
    items.push(item);
  }
  return items;
}

function itemSample(itemType: DataType, index: number, random: SeededRandom): unknown {
  switch (itemType) {
    case 'INTEGER':
      return index + 1;
    case 'DECIMAL':
    case 'CURRENCY':
      return roundTo(index + random.float(0, 1, 2), 2);
    case 'PERCENTAGE':
      return roundTo(random.float(0, 100, 2), 2);
    case 'BOOLEAN':
      return random.bool();
    case 'DATE':
      return random.isoDate();
    case 'DATETIME':
      return `${random.isoDate()}T00:00:00Z`;
    case 'TIME':
      return `${pad(random.int(0, 23))}:${pad(random.int(0, 59))}`;
    case 'LIST':
      return [index + 1];
    case 'OBJECT':
    case 'STRUCTURED_RESULT':
      return { valor: index + 1 };
    default:
      return `${random.string(4, alphabetFor(itemType))}${index}`;
  }
}

function stableKey(value: unknown): string {
  return JSON.stringify(value) ?? 'undefined';
}

/* ---------------------------------------------------------------- reparación */

/**
 * Valores derivados directamente del contrato, en orden de fidelidad. Se usan cuando el
 * sorteo no consiguió un valor aceptable: casi siempre es una combinación estrecha
 * (`allowedValues` junto a `min`, o una longitud exacta) que el azar no acierta.
 */
export function repairCandidates(type: DataType, constraints: VariableConstraints): unknown[] {
  const candidates: unknown[] = [];
  if (constraints.allowedValues?.length) candidates.push(...constraints.allowedValues);

  const scale = constraints.scale ?? (type === 'INTEGER' ? 0 : 2);
  const [min, max] = numericRange(type, constraints, scale);
  candidates.push(roundTo(min, scale), roundTo(max, scale));

  if (constraints.minLength !== undefined) candidates.push('a'.repeat(constraints.minLength));
  if (constraints.maxLength !== undefined) candidates.push('a'.repeat(constraints.maxLength));

  const [lower] = [Math.max(0, constraints.minItems ?? 0)];
  candidates.push(Array.from({ length: lower }, (_, index) => index + 1));
  return candidates;
}

/* ------------------------------------------------------------------ auxiliares */

/** Peso declarado para un valor concreto de una enumeración; 1 cuando no se declaró. */
export function weightFor(distribution: VariableDistribution | undefined, value: unknown): number {
  const weights = distribution?.valueWeights;
  if (!weights) return 1;
  const declared = weights[String(value)];
  return declared === undefined ? 1 : declared;
}

/**
 * Proporción de `true` para un booleano sesgado. Se deriva de los mismos `valueWeights`
 * que las enumeraciones para no inventar una segunda forma de decir lo mismo.
 */
export function booleanProbability(distribution: VariableDistribution | undefined): number {
  const weights = distribution?.valueWeights;
  if (!weights) return 0.5;
  const positive = Math.max(0, Number(weights.true ?? weights.TRUE ?? 1));
  const negative = Math.max(0, Number(weights.false ?? weights.FALSE ?? 1));
  const total = positive + negative;
  return total > 0 ? positive / total : 0.5;
}

export function pad(value: number): string {
  return String(value).padStart(2, '0');
}
