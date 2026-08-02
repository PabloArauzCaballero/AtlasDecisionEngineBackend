/**
 * Evalúa el árbol de operaciones del constructor visual (§6.1).
 *
 * No hay `eval`, ni sandbox, ni proceso hijo: el árbol solo puede invocar funciones de
 * este archivo, así que la modalidad visual es estructuralmente incapaz de ejecutar
 * código arbitrario. Por eso es la modalidad recomendada frente a JS/Python.
 */
import { DomainException } from '../../common/errors/domain-exception';
import { OPERATIONS_BY_ID } from './operation-catalog';
import type { OperationNode } from './calculated-field.types';

/** Tope de profundidad: un árbol anidado sin límite agotaría la pila (§6.3). */
const MAX_DEPTH = 24;
const MAX_NODES = 200;

export interface OperationEvalOptions {
  /** Qué hacer ante una división entre cero: lanzar o devolver null. */
  divisionByZeroReturnsNull: boolean;
}

export function evaluateOperation(
  node: OperationNode,
  inputs: Record<string, unknown>,
  options: OperationEvalOptions = { divisionByZeroReturnsNull: false },
): unknown {
  let visited = 0;
  const walk = (current: unknown, depth: number): unknown => {
    visited += 1;
    if (depth > MAX_DEPTH) {
      throw new DomainException(
        'CALCULATED_FIELD_TREE_TOO_DEEP',
        `El árbol de operaciones supera la profundidad máxima de ${MAX_DEPTH}`,
      );
    }
    if (visited > MAX_NODES) {
      throw new DomainException(
        'CALCULATED_FIELD_TREE_TOO_LARGE',
        `El árbol de operaciones supera los ${MAX_NODES} nodos`,
      );
    }
    if (current === null || typeof current !== 'object') return current;
    const record = current as Record<string, unknown>;
    if ('literal' in record) return record.literal;
    if ('input' in record) {
      const id = String(record.input);
      if (!(id in inputs)) {
        throw new DomainException(
          'CALCULATED_FIELD_INPUT_MISSING',
          `El árbol referencia la entrada ${id}, que no fue provista`,
        );
      }
      return inputs[id];
    }
    const operationId = String(record.operation ?? '');
    const definition = OPERATIONS_BY_ID.get(operationId);
    if (!definition) {
      throw new DomainException(
        'CALCULATED_FIELD_OPERATION_UNKNOWN',
        `La operación ${operationId || '(vacía)'} no está en el catálogo autorizado`,
      );
    }
    const args = Array.isArray(record.args) ? record.args.map((arg) => walk(arg, depth + 1)) : [];
    return applyOperation(operationId, args, inputs, options);
  };
  return walk(node, 0);
}

function applyOperation(
  id: string,
  args: unknown[],
  inputs: Record<string, unknown>,
  options: OperationEvalOptions,
): unknown {
  switch (id) {
    case 'ADD':
      return numbers(args, id).reduce((total, value) => total + value, 0);
    case 'SUBTRACT':
      return num(args[0], id) - num(args[1], id);
    case 'MULTIPLY':
      return numbers(args, id).reduce((total, value) => total * value, 1);
    case 'DIVIDE': {
      const divisor = num(args[1], id);
      if (divisor === 0) {
        if (options.divisionByZeroReturnsNull) return null;
        throw new DomainException(
          'CALCULATED_FIELD_DIVISION_BY_ZERO',
          'División entre cero en el campo calculado',
        );
      }
      return num(args[0], id) / divisor;
    }
    case 'ABS':
      return Math.abs(num(args[0], id));
    case 'ROUND': {
      const factor = 10 ** (args[1] === undefined ? 0 : Math.trunc(num(args[1], id)));
      return Math.round(num(args[0], id) * factor) / factor;
    }
    case 'FLOOR':
      return Math.floor(num(args[0], id));
    case 'CEIL':
      return Math.ceil(num(args[0], id));
    case 'POWER':
      return num(args[0], id) ** num(args[1], id);
    case 'CLAMP':
      return Math.min(Math.max(num(args[0], id), num(args[1], id)), num(args[2], id));
    case 'MIN':
      return Math.min(...numbers(args, id));
    case 'MAX':
      return Math.max(...numbers(args, id));
    case 'AVERAGE': {
      const values = numberList(args[0], id);
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    }
    case 'MEDIAN': {
      const values = [...numberList(args[0], id)].sort((a, b) => a - b);
      if (!values.length) return null;
      const middle = Math.floor(values.length / 2);
      return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    }
    case 'STDDEV': {
      const values = numberList(args[0], id);
      if (!values.length) return null;
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance =
        values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
      return Math.sqrt(variance);
    }
    case 'AGE_YEARS':
      return yearsBetween(dateOf(args[0], id), dateOf(args[1], id));
    case 'DAYS_BETWEEN':
      return Math.floor(
        (dateOf(args[1], id).getTime() - dateOf(args[0], id).getTime()) / 86_400_000,
      );
    case 'MONTHS_BETWEEN': {
      const from = dateOf(args[0], id);
      const to = dateOf(args[1], id);
      const months =
        (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
        (to.getUTCMonth() - from.getUTCMonth());
      return to.getUTCDate() < from.getUTCDate() ? months - 1 : months;
    }
    case 'CONCAT':
      return args
        .map((value) => (value === null || value === undefined ? '' : String(value)))
        .join('');
    case 'UPPER':
      return str(args[0], id).toUpperCase();
    case 'LOWER':
      return str(args[0], id).toLowerCase();
    case 'TRIM':
      return str(args[0], id).trim();
    case 'LENGTH':
      return str(args[0], id).length;
    case 'TO_NUMBER': {
      const parsed = Number(args[0]);
      if (!Number.isFinite(parsed)) {
        throw new DomainException(
          'CALCULATED_FIELD_CONVERSION_FAILED',
          `TO_NUMBER no pudo convertir el valor recibido`,
        );
      }
      return parsed;
    }
    case 'TO_TEXT':
      return args[0] === null || args[0] === undefined ? '' : String(args[0]);
    case 'TO_PERCENTAGE':
      return num(args[0], id) * 100;
    case 'EQUALS':
      return args[0] === args[1];
    case 'GREATER_THAN':
      return num(args[0], id) > num(args[1], id);
    case 'LESS_THAN':
      return num(args[0], id) < num(args[1], id);
    case 'BETWEEN':
      return num(args[0], id) >= num(args[1], id) && num(args[0], id) <= num(args[2], id);
    case 'AND':
      return args.every((value) => value === true);
    case 'OR':
      return args.some((value) => value === true);
    case 'NOT':
      return args[0] !== true;
    case 'IF':
      return args[0] === true ? args[1] : args[2];
    case 'COALESCE':
      return args.find((value) => value !== null && value !== undefined) ?? null;
    case 'COUNT':
      return listOf(args[0], id).length;
    case 'SUM':
      return numberList(args[0], id).reduce((a, b) => a + b, 0);
    case 'CONTAINS':
      return listOf(args[0], id).includes(args[1]);
    case 'INPUT': {
      const key = str(args[0], id);
      if (!(key in inputs)) {
        throw new DomainException(
          'CALCULATED_FIELD_INPUT_MISSING',
          `El árbol referencia la entrada ${key}, que no fue provista`,
        );
      }
      return inputs[key];
    }
    case 'CONSTANT':
      return args[0];
    default:
      throw new DomainException(
        'CALCULATED_FIELD_OPERATION_UNKNOWN',
        `La operación ${id} no tiene implementación`,
      );
  }
}

function num(value: unknown, operation: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new DomainException(
    'CALCULATED_FIELD_ARGUMENT_INVALID',
    `${operation} espera un número y recibió ${describe(value)}`,
  );
}

function numbers(args: unknown[], operation: string): number[] {
  return args.map((value) => num(value, operation));
}

function str(value: unknown, operation: string): string {
  if (typeof value === 'string') return value;
  throw new DomainException(
    'CALCULATED_FIELD_ARGUMENT_INVALID',
    `${operation} espera texto y recibió ${describe(value)}`,
  );
}

function listOf(value: unknown, operation: string): unknown[] {
  if (Array.isArray(value)) return value;
  throw new DomainException(
    'CALCULATED_FIELD_ARGUMENT_INVALID',
    `${operation} espera una lista y recibió ${describe(value)}`,
  );
}

function numberList(value: unknown, operation: string): number[] {
  return listOf(value, operation).map((item) => num(item, operation));
}

function dateOf(value: unknown, operation: string): Date {
  const parsed = typeof value === 'string' ? new Date(value) : new Date(NaN);
  if (Number.isNaN(parsed.getTime())) {
    throw new DomainException(
      'CALCULATED_FIELD_ARGUMENT_INVALID',
      `${operation} espera una fecha ISO y recibió ${describe(value)}`,
    );
  }
  return parsed;
}

function yearsBetween(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const monthDelta = to.getUTCMonth() - from.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && to.getUTCDate() < from.getUTCDate())) years -= 1;
  return years;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'un valor ausente';
  if (Array.isArray(value)) return 'una lista';
  return typeof value;
}
