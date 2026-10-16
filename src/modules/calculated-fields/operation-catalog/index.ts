/**
 * Catálogo de operaciones del constructor visual (§6.1).
 *
 * Es una lista blanca cerrada: el árbol de operaciones que llega del frontend solo
 * puede invocar lo que está aquí. Cualquier operación desconocida se rechaza, así que
 * el "constructor visual" no es una vía alternativa para ejecutar código arbitrario.
 */
import type { OperationCategory, OperationDefinition } from './types';
import { LOGIC_LIST_AND_DATA_OPERATIONS } from './logic-lists-data';
import { MATH_OPERATIONS } from './math';
import { STATISTICS_AND_DATE_OPERATIONS } from './statistics-and-dates';
import { TEXT_AND_CONVERSION_OPERATIONS } from './text-and-conversion';

export type { OperationArgument, OperationCategory, OperationDefinition } from './types';

export const OPERATIONS: readonly OperationDefinition[] = [
  ...MATH_OPERATIONS,
  ...STATISTICS_AND_DATE_OPERATIONS,
  ...TEXT_AND_CONVERSION_OPERATIONS,
  ...LOGIC_LIST_AND_DATA_OPERATIONS,
];

export const OPERATIONS_BY_ID: ReadonlyMap<string, OperationDefinition> = new Map(
  OPERATIONS.map((operation) => [operation.id, operation]),
);

export const OPERATION_CATEGORIES: readonly OperationCategory[] = [
  ...new Set(OPERATIONS.map((operation) => operation.category)),
];
