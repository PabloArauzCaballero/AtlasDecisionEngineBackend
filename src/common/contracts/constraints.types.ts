/** Forma normalizada de las restricciones configurables de una variable (§1.1). */
import type { DataType } from './data-types';

/** Restricción que solo aplica si se cumple una condición sobre otro campo. */
export interface ConditionalRule {
  /** Código de la variable observada. */
  whenField: string;
  /** Operador de comparación aplicado al valor de `whenField`. */
  operator:
    'EQUALS' | 'NOT_EQUALS' | 'IN' | 'NOT_IN' | 'GREATER_THAN' | 'LESS_THAN' | 'PRESENT' | 'ABSENT';
  value?: unknown;
  /** Restricciones que se añaden cuando la condición se cumple. */
  constraints?: VariableConstraints;
  /** Si es true, el campo pasa a ser obligatorio cuando la condición se cumple. */
  required?: boolean;
  /** Mensaje específico para esta regla. */
  message?: string;
}

/** Restricción que solo aplica en un eje de despliegue (país, producto, ambiente…). */
export interface ScopedConstraint {
  /** Valores del eje en los que aplica; vacío = todos. */
  match: string[];
  constraints: VariableConstraints;
}

export interface VariableConstraints {
  min?: number;
  max?: number;
  exclusiveMin?: number;
  exclusiveMax?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  /** Dígitos significativos totales admitidos para tipos numéricos. */
  precision?: number;
  /** Decimales admitidos para tipos numéricos. */
  scale?: number;
  pattern?: string;
  allowedValues?: unknown[];
  /** Formato semántico: EMAIL, UUID, IBAN, ISO_COUNTRY, ISO_CURRENCY, URL, PHONE. */
  format?: string;
  /** Los elementos de una lista deben ser distintos entre sí. */
  unique?: boolean;
  nullable?: boolean;
  /** El valor solo es válido si estos campos también están presentes. */
  dependsOn?: string[];
  conditional?: ConditionalRule[];
  byCountry?: ScopedConstraint[];
  byProduct?: ScopedConstraint[];
  byEnvironment?: ScopedConstraint[];
  byTenant?: ScopedConstraint[];
  byContractVersion?: ScopedConstraint[];
  /** Tipo de los elementos, para listas homogéneas. */
  itemType?: DataType;
}

/** Ejes de despliegue conocidos por el motor al evaluar restricciones acotadas. */
export interface ConstraintScope {
  environmentCode?: string;
  tenantId?: string;
  country?: string;
  product?: string;
  contractVersion?: string;
}

export interface ConstraintContext extends ConstraintScope {
  /** Valores del resto del contrato, para `dependsOn` y reglas condicionales. */
  siblings: Record<string, unknown>;
}

export interface ConstraintViolation {
  /** Código estable, apto para telemetría y para mapear a mensajes de UI. */
  code: string;
  message: string;
  constraint: string;
}

export const EMPTY_CONTEXT: ConstraintContext = { siblings: {} };
