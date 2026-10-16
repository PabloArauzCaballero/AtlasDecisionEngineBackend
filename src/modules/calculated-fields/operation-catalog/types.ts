import type { DataType } from '../../../common/contracts/data-types';

export type OperationCategory =
  | 'MATH'
  | 'STATISTICS'
  | 'DATE'
  | 'TEXT'
  | 'CONVERSION'
  | 'COMPARISON'
  | 'LOGIC'
  | 'LIST'
  | 'AGGREGATION'
  | 'DATA';

export interface OperationArgument {
  name: string;
  /** Tipos admitidos; vacío = cualquiera. */
  types: DataType[];
  required: boolean;
  description: string;
}

export interface OperationDefinition {
  id: string;
  label: string;
  category: OperationCategory;
  description: string;
  args: OperationArgument[];
  /** Tipo del valor devuelto. */
  returns: DataType;
  /** Aridad variable (SUM, MIN, MAX sobre N argumentos). */
  variadic?: boolean;
  /** Documentación breve mostrada en el panel. */
  example: string;
}
