/** Estados posibles de un valor durante la ejecución (§3.1). */
export type ValueLifecycleState =
  | 'NOT_AVAILABLE'
  | 'AVAILABLE'
  | 'VALID'
  | 'INVALID'
  | 'COMPUTED'
  | 'UPDATED'
  | 'CONSUMED'
  | 'SKIPPED'
  | 'ERROR'
  | 'REDACTED';

/** Estado de un valor concreto en un nodo (§3.1). */
export interface NodeValueState {
  code: string;
  dataType: string;
  state: ValueLifecycleState;
  value: unknown;
  sensitivityClass: string;
  /**
   * De dónde procede el valor: para una entrada es el origen declarado en su contrato;
   * para una salida, el tipo de origen del contrato de salida.
   */
  origin: string;
}

/** Estado de una variable intermedia en un punto de la ejecución (§2.2 / §3.1). */
export interface IntermediateStateEntry {
  code: string;
  dataType: string;
  state: ValueLifecycleState;
  /** Valor ya sanitizado según la política de traza de la variable. */
  value: unknown;
  producerNodeKey: string;
  writtenByNodeKey?: string;
  consumedByNodeKeys: string[];
  previousValue?: unknown;
  /**
   * Índice (base 0) del paso de la traza que le dio valor por primera vez (§3.1,
   * "momento de creación"). Ausente en dos casos que no son lo mismo y por eso no se
   * colapsan en un 0: la variable sigue en NOT_AVAILABLE, o nació con `initialValue` y
   * por tanto existía antes de que se ejecutara ningún nodo.
   *
   * Es el índice del paso y no una marca de tiempo porque lo que reconstruye el
   * razonamiento es el ORDEN dentro de la traza; un reloj además haría que dos
   * ejecuciones idénticas produjeran trazas distintas.
   */
  createdAtStepIndex?: number;
  sensitivityClass: string;
  tracePolicy: string;
}

/**
 * Qué procesó un nodo, separado por naturaleza del dato (§3): lo que recibió, las
 * intermedias antes y después, y qué salidas públicas dejó escritas. No todo valor
 * que produce un nodo es una salida del artefacto.
 */
export interface NodeVariableState {
  nodeKey: string;
  /** COMPLETED cuando el nodo terminó; ERROR cuando abortó la ejecución. */
  status: 'COMPLETED' | 'ERROR';
  durationUs: number;
  inputs: NodeValueState[];
  intermediatesBefore: IntermediateStateEntry[];
  intermediatesAfter: IntermediateStateEntry[];
  intermediatesCreated: string[];
  intermediatesUpdated: string[];
  outputs: NodeValueState[];
  /** Errores del nodo. Vacío salvo que la ejecución abortara aquí. */
  errors: Array<{ code: string; message: string }>;
  /** Avisos que no detienen la ejecución (p. ej. una intermedia creada y no consumida). */
  warnings: string[];
}
