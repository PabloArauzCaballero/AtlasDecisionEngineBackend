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
  /**
   * Corrida de identidad que conserva las imágenes sobre las que se decidió. Viaja a la traza
   * del paso (`evaluation.worker`) para que el detalle de la ejecución las pueda enseñar por
   * `GET /v1/workers/identity-verification/runs/:requestId/images/:kind`.
   */
  evidenceRequestId?: string;
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
