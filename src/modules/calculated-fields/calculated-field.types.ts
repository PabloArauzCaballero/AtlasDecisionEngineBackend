/** Contrato de un campo calculado (§5.2, §5.3). */
import type { DataType } from '../../common/contracts/data-types';
import type { VariableConstraints } from '../../common/contracts/constraints.types';

/** Nodo del árbol de operaciones del constructor visual (§6.1). */
export interface OperationNode {
  operation: string;
  args: Array<OperationNode | { literal: unknown } | { input: string }>;
}

export interface CalculatedFieldInput {
  id: string;
  name: string;
  description: string;
  dataType: DataType | string;
  required: boolean;
  constraints?: VariableConstraints;
  defaultValue?: unknown;
}

/** Política ante datos que impiden calcular (§5.3). */
export type MissingDataPolicy = 'FAIL' | 'RETURN_NULL' | 'RETURN_DEFAULT';

export interface CalculatedFieldReturn {
  dataType: DataType | string;
  /** ¿Puede devolver null? Si es false, RETURN_NULL deja de ser una política válida. */
  nullable: boolean;
  constraints?: VariableConstraints;
  /** Decimales del resultado; se aplica antes de validar las restricciones. */
  precision?: number;
  /** Condiciones documentadas en las que no devuelve valor. */
  nullConditions: string[];
  /** Qué hacer ante una división entre cero. */
  divisionByZero: MissingDataPolicy;
  /** Qué hacer cuando falta una entrada opcional necesaria para el cálculo. */
  missingData: MissingDataPolicy;
  /** Qué hacer cuando el resultado queda fuera de las restricciones declaradas. */
  outOfRange: MissingDataPolicy;
  /** Código de error emitido cuando la política es FAIL. */
  errorCode: string;
  description?: string;
}

/** Comentarios estructurados, fuera del código ejecutable (§5.4). */
export interface CalculatedFieldComments {
  overview?: string;
  functional?: string;
  inputsExplained?: string;
  outputExplained?: string;
  assumptions?: string[];
  limitations?: string[];
  example?: string;
  rationale?: string;
}

export interface CalculatedFieldContract {
  inputs: CalculatedFieldInput[];
  returns: CalculatedFieldReturn;
  comments?: CalculatedFieldComments;
}

export interface CalculatedFieldExecutionResult {
  value: unknown;
  /** VALID | NULL_BY_POLICY | DEFAULTED. */
  outcome: 'VALID' | 'NULL_BY_POLICY' | 'DEFAULTED';
  durationMs: number;
}
