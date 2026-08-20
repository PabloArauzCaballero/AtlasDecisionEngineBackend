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

/**
 * Invocación de un campo calculado desde un nodo del grafo (§5.1).
 *
 * La definición del campo viaja EMBEBIDA en el artefacto compilado, no se consulta en
 * ejecución. Así una decisión sigue siendo reproducible aunque el campo se deprecie o se
 * republique después, igual que ocurre con las variables y las condiciones.
 */
export interface CalculatedFieldCallSnapshot {
  /** Identificador de la llamada dentro del nodo. */
  callKey: string;
  fieldCode: string;
  /** Versión fijada del campo calculado. */
  calculatedFieldVersionId: string;
  versionNumber: number;
  /** Cómo se alimenta cada entrada del campo: `{ [inputId]: origen }`. */
  inputMapping: Record<
    string,
    {
      source: 'VARIABLE' | 'INTERMEDIATE' | 'LITERAL' | 'EXPRESSION';
      path?: string;
      value?: unknown;
      expression?: unknown;
    }
  >;
  /** Dónde se deja el resultado. */
  target: { kind: 'INTERMEDIATE' | 'OUTPUT'; code: string };
  /** Definición congelada, lista para ejecutarse sin tocar la base de datos. */
  definition: {
    implementationKind: 'OPERATION' | 'JAVASCRIPT' | 'PYTHON';
    contract: unknown;
    operation?: unknown;
    sourceCode?: string;
    libraryPackages: string[];
    defaultValue?: unknown;
    timeoutMs?: number;
  };
}

/** Una invocación de campo calculado tal como ocurrió, para la traza (§12). */
export interface CalculatedFieldTraceEntry {
  nodeKey: string;
  callKey: string;
  fieldCode: string;
  versionNumber: number;
  target: string;
  outcome: 'VALID' | 'NULL_BY_POLICY' | 'DEFAULTED' | 'ERROR';
  durationMs: number;
  value?: unknown;
  errorCode?: string;
}

/**
 * Cómo se alimenta un argumento de la llamada a un servicio de worker.
 *
 * Deliberadamente los mismos orígenes que ya usan las asignaciones de intermedias y las
 * entradas de un campo calculado: un autor que sabe rellenar un nodo Expresión no tiene
 * que aprender un segundo vocabulario para rellenar un nodo Servicio.
 */
export interface WorkerArgumentBinding {
  source: 'VARIABLE' | 'INTERMEDIATE' | 'LITERAL' | 'EXPRESSION' | 'TEMPLATE';
  path?: string;
  value?: unknown;
  expression?: unknown;
}

/**
 * Dónde deja el nodo un trozo de la respuesta del servicio.
 *
 * El destino es SIEMPRE una variable intermedia declarada por el grafo (§2): así el valor
 * que trae un servicio externo pasa por el mismo contrato de tipo, la misma autorización
 * de escritura y la misma política de traza que cualquier otro valor calculado, en vez de
 * entrar al motor por una puerta propia.
 */
export interface WorkerOutputBinding {
  intermediateCode: string;
  /** `PATH` (por defecto) lee una ruta de la respuesta; `EXPRESSION` la combina. */
  source?: 'PATH' | 'EXPRESSION';
  /**
   * Ruta sobre `{ result, call }`: `result.*` es la respuesta del servicio y `call.*` los
   * metadatos de la llamada (`status`, `errorCode`, `durationMs`, `warningCount`). Están
   * separados para que una respuesta con un campo llamado `status` no tape el estado real
   * de la llamada.
   */
  path?: string;
  expression?: unknown;
  /** Valor cuando la ruta no resuelve. Obligatorio con `onError: 'CONTINUE'`. */
  defaultValue?: unknown;
}

/**
 * Llamada a un servicio de worker declarada por un nodo `WORKER` (§ workers en el motor).
 *
 * Es una ACCIÓN del algoritmo: el nodo invoca el servicio durante la decisión y espera su
 * respuesta, igual que un nodo de referencia ejecuta otro artefacto. Lo que el servicio
 * devuelve no sale al contrato público: se proyecta a variables intermedias, y a partir de
 * ahí es un valor más del que el motor puede razonar.
 */
export interface WorkerCallSnapshot {
  /** Código del servicio, el mismo que publica el catálogo `/v1/workers`. */
  service: string;
  /** Operación dentro del servicio. Cada servicio publica las suyas. */
  operation: string;
  arguments: Record<string, WorkerArgumentBinding>;
  outputs: WorkerOutputBinding[];
  /**
   * Qué hacer si el servicio falla. `FAIL` aborta la decisión; `CONTINUE` escribe los
   * valores por defecto de cada proyección y deja que el grafo decida con ellos —para eso
   * el validador exige que todas los declaren.
   */
  onError: 'FAIL' | 'CONTINUE';
  /** Cota de la llamada. El invocador la recorta al máximo configurado del servicio. */
  timeoutMs?: number;
}

/** Una llamada a un servicio de worker tal como ocurrió, para la traza. */
export interface WorkerCallTraceEntry {
  nodeKey: string;
  service: string;
  operation: string;
  status: 'SUCCEEDED' | 'SUCCEEDED_WITH_WARNINGS' | 'FAILED';
  durationMs: number;
  /** Intermedias que la llamada dejó escritas. Nunca el valor: eso ya va en la traza. */
  outputs: string[];
  warnings: string[];
  errorCode?: string;
}

/** Petición que el motor entrega al invocador, con los argumentos ya resueltos. */
export interface WorkerServiceRequest {
  service: string;
  operation: string;
  nodeKey: string;
  arguments: Record<string, unknown>;
  timeoutMs?: number;
}

export interface WorkerServiceOutcome {
  status: 'SUCCEEDED' | 'SUCCEEDED_WITH_WARNINGS';
  /** Respuesta del servicio, tal cual. El nodo decide qué trozos le interesan. */
  result: Record<string, unknown>;
  warnings: string[];
  durationMs: number;
}

/**
 * Ejecuta la llamada que un nodo `WORKER` declara.
 *
 * Lo implementa `WorkerServiceInvokerService` (src/modules/workers) y se pasa a
 * `ExecutionEngineService.execute()` como argumento de llamada —nunca como dependencia de
 * constructor—, por el mismo motivo que `ArtifactReferenceResolver`: así `GraphModule` no
 * depende de `WorkersModule` y no hay ciclo entre ellos. Un nodo `WORKER` alcanzado sin
 * invocador falla cerrado con `WORKER_SERVICE_NOT_CONFIGURED`.
 */
export interface WorkerServiceInvoker {
  invoke(request: WorkerServiceRequest): Promise<WorkerServiceOutcome>;
}

/** Gobierno y origen de un campo del contrato de salida (§4). */
export interface OutputContractFieldSnapshot {
  id?: string;
  code: string;
  name: string;
  description?: string | null;
  sourceKind: 'NODE' | 'EXPRESSION' | 'INTERMEDIATE' | 'CONSTANT' | 'REFERENCE';
  sourceRef: string;
  valueMapping?: Record<string, unknown> | null;
  absenceReasons: string[];
  /** Códigos del catálogo que la decisión puede devolver con este campo (§4). */
  reasonCodes?: string[];
  example?: unknown;
  contractVersion: string;
  sensitivityClass: string;
  tracePolicy: 'FULL' | 'MASKED' | 'REDACTED' | 'EXCLUDED';
}

export interface GraphConditionSnapshot {
  id?: string;
  code: string;
  name: string;
  expressionType: string;
  expression: unknown;
  severity: string;
  reusable: boolean;
}

export interface GraphActionSnapshot {
  id?: string;
  code: string;
  type: string;
  payload: Record<string, unknown>;
  terminal: boolean;
  reasonCodes: Array<{
    id?: string;
    code: string;
    category: string;
    publicMessage: string;
    internalMessage: string;
    severity: string;
    adverseAction: boolean;
    priority: number;
  }>;
}

export interface GraphNodeSnapshot {
  id?: string;
  key: string;
  type: NodeType;
  label: string;
  config: Record<string, unknown>;
  x: number;
  y: number;
  order: number;
  terminal: boolean;
  conditions: Array<{ code: string; order: number; expected: boolean }>;
  actions: Array<{ code: string; order: number }>;
  /** Campos calculados que este nodo invoca (§5.1). Vacío en la mayoría de nodos. */
  calculatedFieldCalls?: CalculatedFieldCallSnapshot[];
}

export interface GraphEdgeSnapshot {
  id?: string;
  key: string;
  from: string;
  to: string;
  type: string;
  priority: number;
  default: boolean;
  conditions: Array<{ code: string; order: number }>;
}

export interface ArtifactGraphSnapshot {
  artifact: {
    id: string;
    tenantId: string;
    code: string;
    type: string;
    name: string;
    riskDomain: string;
  };
  version: {
    id: string;
    number: number;
    semanticVersion: string;
    status: string;
    checksum?: string | null;
    authoringNotes?: string | null;
    /** Finalidad declarada del tratamiento (LGPD art. 6 I). */
    processingPurpose?: string | null;
    /** Base legal declarada (LGPD arts. 7 y 11); exigida para consumir categorías especiales. */
    legalBasis?: string | null;
  };
  variables: VariableContractSnapshot[];
  /** Variables intermedias declaradas por este grafo (§2). */
  intermediates: IntermediateVariableSnapshot[];
  /** Contrato de salida explícito con el origen de cada campo (§4). */
  outputContract: OutputContractFieldSnapshot[];
  conditions: GraphConditionSnapshot[];
  actions: GraphActionSnapshot[];
  nodes: GraphNodeSnapshot[];
  edges: GraphEdgeSnapshot[];
}

export interface ValidationIssue {
  code: string;
  message: string;
  severity: 'ERROR' | 'WARNING';
  entityType?: 'VERSION' | 'VARIABLE' | 'NODE' | 'EDGE' | 'CONDITION' | 'ACTION';
  entityKey?: string;
  path?: string;
}

export interface GraphValidationReport {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  metrics: {
    nodeCount: number;
    edgeCount: number;
    reachableNodeCount: number;
    terminalNodeCount: number;
    terminalPathCount: number;
  };
  canonicalAst?: ArtifactGraphSnapshot;
  checksum?: string;
}

export interface CompiledDecisionArtifact {
  runtimeSchemaVersion: '1.0' | '1.1' | '1.2';
  compilerVersion: string;
  artifact: ArtifactGraphSnapshot['artifact'];
  version: ArtifactGraphSnapshot['version'];
  variables: VariableContractSnapshot[];
  /** Compilado a partir del snapshot; `[]` en artefactos compilados antes de §2. */
  intermediates: IntermediateVariableSnapshot[];
  outputContract: OutputContractFieldSnapshot[];
  startNodeKey: string;
  nodes: Record<string, GraphNodeSnapshot>;
  edgesByNode: Record<string, GraphEdgeSnapshot[]>;
  conditions: Record<string, GraphConditionSnapshot>;
  actions: Record<string, GraphActionSnapshot>;
  totals: {
    nodes: number;
    edges: number;
    terminalPaths: number;
  };
}

export interface DecisionReasonResult {
  reasonCodeId?: string;
  sourceActionId?: string;
  code: string;
  category: string;
  message: string;
  internalMessage: string;
  severity: string;
  adverseAction: boolean;
  priority: number;
}

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

export interface ExecutionTraceStep {
  nodeId?: string;
  nodeKey: string;
  nodeType: string;
  branchTaken?: string;
  evaluation: Record<string, unknown>;
  durationUs: number;
  /** Ausente en artefactos compilados antes de §3. */
  variableState?: NodeVariableState;
}

export interface EngineExecutionResult {
  status: 'SUCCEEDED' | 'NO_DECISION' | 'FAILED';
  outcome: string;
  score?: number;
  riskBand?: string;
  limit?: number;
  output: Record<string, unknown>;
  primaryResult?: { code: string; value: unknown };
  reasons: DecisionReasonResult[];
  trace: ExecutionTraceStep[];
  visitedNodeKeys: string[];
  traversedEdgeKeys: string[];
  terminalNodeKey?: string;
  manualReview?: {
    queueCode: string;
    priority: number;
    slaMinutes: number;
    evidence: Record<string, unknown>;
  };
  /**
   * Flattened trace of every nested artifact-reference invocation this execution made
   * (Fase 7 — nested decision trees), in preorder. Empty unless the compiled graph
   * contains a RESULT node with `mode: 'REFERENCE'` and a resolver was supplied to
   * `execute()`. See ArtifactReferenceResolver.
   */
  nestedExecutions: NestedExecutionTraceEntry[];
  /** Toda invocación de campo calculado de esta ejecución, en orden (§12). */
  calculatedFieldCalls: CalculatedFieldTraceEntry[];
  /**
   * Toda llamada a un servicio de worker de esta ejecución, en orden. Vacío salvo que el
   * grafo tenga nodos `WORKER`.
   */
  workerCalls: WorkerCallTraceEntry[];
}

/**
 * One nested-artifact-reference invocation, as recorded during execution. Persisted
 * as a `DecisionExecutionTreeLink` row once the owning (root) execution is written —
 * see NestedTreeExecutionService and ExecutionWriterService.
 */
export interface NestedExecutionTraceEntry {
  /** Preorder position of this call within the root execution's nested-call trace. */
  sequence: number;
  /** Sequence of the nested call that invoked this one; null for a depth-1 call made
   *  directly from the root artifact's own graph. */
  parentSequence: number | null;
  depth: number;
  nodeKey: string;
  /** Null only for a FALLBACK/SKIP entry recorded before a child version could be resolved. */
  childArtifactVersionId: string | null;
  status: 'SUCCEEDED' | 'FAILED' | 'FALLBACK' | 'SKIPPED';
  durationMs: number;
  output?: Record<string, unknown>;
  error?: { code: string; message: string };
}

export interface ArtifactReferenceResolution {
  /** This call's own output, keyed by the CHILD artifact's output variable codes. */
  output: Record<string, unknown>;
  /** This call's own trace entry plus every descendant call it made, flattened. */
  trace: NestedExecutionTraceEntry[];
}

/** Mutable cursor threaded through a nested-call chain to assign global sequence
 *  numbers and track recursion depth without any shared engine state. */
export interface NestedReferenceCursor {
  sequence: { value: number };
  parentSequence: number | null;
  depth: number;
}

/**
 * Resolves a RESULT node's `mode: 'REFERENCE'` invocation to a child artifact's output.
 * Implemented by NestedTreeExecutionService (src/modules/nested-trees) and passed into
 * ExecutionEngineService.execute() as a plain call argument — never a constructor
 * dependency — so the graph engine stays decoupled from the nested-trees module and
 * every existing caller that omits it keeps working unchanged (a REFERENCE node hit
 * without a resolver fails closed with NESTED_REFERENCE_NOT_CONFIGURED).
 */
export interface ArtifactReferenceResolver {
  resolve(
    parentArtifactVersionId: string,
    nodeKey: string,
    context: Record<string, unknown>,
    cursor: NestedReferenceCursor,
  ): Promise<ArtifactReferenceResolution>;
}

/**
 * One node-by-node progress update during execution (Fase 8 — live execution).
 * Passed as a plain call argument to `execute()`, never a constructor dependency —
 * same reasoning as ArtifactReferenceResolver: callers that don't care (most of
 * them) simply omit it, with zero change to their behavior or dependency graph.
 */
export interface LiveStepEvent {
  status: 'RUNNING' | 'COMPLETED' | 'ERROR';
  nodeKey: string;
  nodeType: string;
  /** The edge actually taken, once selected (absent on RUNNING or a terminal node). */
  branchTaken?: string;
  /** Outgoing edges NOT taken at this node, with the reason the engine already
   *  computed while selecting the real one (graph-editor "ramas descartadas"). */
  discardedEdgeKeys?: string[];
  durationUs?: number;
  errorMessage?: string;
}
