import { normalizeDataTypeOrString } from '../../../common/contracts/data-types';
import {
  resolvedConstraintsOf,
  satisfiesContract,
  type GeneratorContractVariable,
} from '../contract-value-factory';

const NUMERIC = new Set(['INTEGER', 'DECIMAL', 'CURRENCY', 'PERCENTAGE']);
const TEXTUAL = new Set(['STRING', 'LONG_TEXT', 'CODE', 'IDENTIFIER', 'ENUM']);

/** Formas equivalentes de un texto: tal cual, en mayúsculas y como código (`LA_PAZ`). */
function textVariants(text: string): string[] {
  const plain = text.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const code = plain
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return [...new Set([text, text.toUpperCase(), code, text.toLowerCase(), plain])];
}

/** Traduce un candidato al tipo del contrato, en todas las formas razonables. */
function asContractType(type: string, value: unknown): unknown[] {
  if (value === undefined || value === null || value === '') return [];
  if (NUMERIC.has(type)) {
    if (typeof value === 'number') return [value];
    const digits = String(value).replace(/^\+591/, '');
    return /^-?\d+(\.\d+)?$/.test(digits) ? [Number(digits)] : [];
  }
  if (type === 'BOOLEAN') return typeof value === 'boolean' ? [value] : [];
  if (type === 'DATE') return typeof value === 'string' ? [value.slice(0, 10)] : [];
  if (type === 'DATETIME') {
    return typeof value === 'string' ? [value.length === 10 ? `${value}T00:00:00Z` : value] : [];
  }
  if (TEXTUAL.has(type)) {
    if (typeof value === 'number') return [String(value)];
    return typeof value === 'string' ? textVariants(value) : [];
  }
  return [];
}

/** Lleva un número al rango del contrato, respetando entero o escala. */
function clampToContract(variable: GeneratorContractVariable, value: number): number | undefined {
  const type = normalizeDataTypeOrString(variable.dataType);
  const constraints = resolvedConstraintsOf(variable);
  const scale = type === 'INTEGER' ? 0 : (constraints.scale ?? 2);
  const step = 10 ** -scale;
  let min = constraints.min ?? -Infinity;
  let max = constraints.max ?? Infinity;
  if (constraints.exclusiveMin !== undefined) min = Math.max(min, constraints.exclusiveMin + step);
  if (constraints.exclusiveMax !== undefined) max = Math.min(max, constraints.exclusiveMax - step);
  if (min > max) return undefined;
  const clamped = Math.min(max, Math.max(min, value));
  const factor = 10 ** scale;
  const rounded =
    clamped === min
      ? Math.ceil(clamped * factor) / factor
      : clamped === max
        ? Math.floor(clamped * factor) / factor
        : Math.round(clamped * factor) / factor;
  return Number(rounded.toFixed(scale));
}

/**
 * El primer candidato que el contrato acepta, o `undefined` si ninguno.
 *
 * Un numérico fuera de rango se lleva al rango antes de rendirse: un ingreso realista de
 * 12 053 Bs sobre un contrato de 1 000 a 10 000 sigue siendo más útil como 10 000 que como
 * un número al azar. Todo lo demás, si el contrato no lo admite, se descarta y el campo se
 * queda con el valor del generador: el faker aporta realismo, nunca relaja una regla.
 */
export function fitToContract(
  variable: GeneratorContractVariable,
  candidates: readonly unknown[],
): unknown {
  const type = normalizeDataTypeOrString(variable.dataType);
  const typed = candidates.flatMap((candidate) => asContractType(type, candidate));
  for (const value of typed) {
    if (satisfiesContract(variable, value)) return value;
  }
  if (NUMERIC.has(type)) {
    const first = typed.find((value): value is number => typeof value === 'number');
    if (first !== undefined) {
      const clamped = clampToContract(variable, first);
      if (clamped !== undefined && satisfiesContract(variable, clamped)) return clamped;
    }
  }
  return undefined;
}
