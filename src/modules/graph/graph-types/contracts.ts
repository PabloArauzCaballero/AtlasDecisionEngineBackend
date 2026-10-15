export type NodeType =
  | 'START'
  | 'CONDITION'
  | 'SWITCH'
  | 'EXPRESSION'
  | 'DECISION_TABLE'
  | 'SCORE'
  | 'ACTION'
  | 'RESULT'
  | 'MANUAL_REVIEW'
  | 'WORKER'
  | 'END';

export interface VariableContractSnapshot {
  variableVersionId: string;
  usageType?: string;
  dependencyPath?: string;
  code: string;
  version: number;
  dataType: string;
  unitCode?: string | null;
  nullable: boolean;
  defaultValue?: unknown;
  validationSchema?: unknown;
  /** Restricciones normalizadas (§1.1); autoritativas frente a `validationSchema`. */
  constraints?: unknown;
  displayName?: string | null;
  description?: string | null;
  /** Mensaje mostrado cuando el valor incumple el contrato. */
  validationMessage?: string | null;
  exampleValid?: unknown;
  exampleInvalid?: unknown;
  /** REQUEST | PROVIDER | DERIVED | CALCULATED_FIELD | GRAPH_NODE. */
  expectedOrigin?: string;
  contractVersion?: string;
  /** Clasificación formal; `sensitive` se conserva como bandera derivada. */
  sensitivityClass?: string;
  /**
   * Licitud de USO en una decisión: `NONE` | `PROHIBITED_BASIS` | `SPECIAL_CATEGORY`.
   *
   * Eje independiente de `sensitivityClass`, que sólo habla de cuánto hay que proteger el
   * dato. Lo aplica `graph-decision-use.validator.ts` al publicar.
   */
  decisionUseRestriction?: string;
  validationRules: Array<{
    ruleType: string;
    config: unknown;
    severity: string;
    errorCode: string;
  }>;
  sources: Array<{
    system: string;
    path: string;
    field: string;
    precedence: number;
    freshnessSlaSeconds: number;
    authoritative: boolean;
  }>;
  required: boolean;
  fallbackPolicy: string;
  sensitive: boolean;
}

/**
 * Variable INTERMEDIATE (§2): existe solo durante una ejecución del grafo que la
 * declara. No es una variable del catálogo y nunca sale en la respuesta pública
 * salvo que un campo del contrato de salida la mapee explícitamente.
 */
export interface IntermediateVariableSnapshot {
  id?: string;
  code: string;
  name: string;
  description: string;
  dataType: string;
  producerNodeKey: string;
  /** Vacío = cualquier nodo alcanzable después del productor puede leerla. */
  consumerNodeKeys: string[];
  initialValue?: unknown;
  constraints?: unknown;
  nullable: boolean;
  updatePolicy: 'SINGLE_WRITE' | 'OVERWRITE' | 'ACCUMULATE';
  availabilityCondition?: unknown;
  sensitivityClass: string;
  tracePolicy: 'FULL' | 'MASKED' | 'REDACTED' | 'EXCLUDED';
}
