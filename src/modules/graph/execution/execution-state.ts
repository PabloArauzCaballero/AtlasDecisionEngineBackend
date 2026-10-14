import { DomainException } from '../../../common/errors/domain-exception';
import type { IntermediateScope } from '../intermediate-scope';
import type {
  CalculatedFieldTraceEntry,
  CompiledDecisionArtifact,
  DecisionReasonResult,
  EngineExecutionResult,
  WorkerCallTraceEntry,
} from '../graph.types';

/**
 * Convierte a número o detiene la ejecución.
 *
 * `Number()` a secas devuelve `NaN` para cualquier cosa que no sea numérica, y `NaN` no
 * levanta ninguna alarma: se propaga por las sumas, sobrevive a `state.score`, y al
 * serializar la respuesta `JSON.stringify` lo convierte en `null`. El solicitante recibía
 * entonces `{"status":"SUCCEEDED","outcome":"APPROVED","score":null}` — una decisión que el
 * motor declara correcta sobre un número que nunca llegó a calcular.
 *
 * Es la misma regla que ya aplicaba `ExpressionEvaluator.asNumber` a las expresiones; lo que
 * faltaba era aplicarla a la otra puerta por la que entran números al estado de la decisión:
 * la configuración de los nodos SCORE y las acciones SET_SCORE/ADD_SCORE/SET_LIMIT, que se
 * escriben a mano en el editor y por tanto son igual de capaces de traer un valor no
 * numérico. `Infinity` se rechaza por el mismo motivo que `NaN`: no es un importe ni una
 * puntuación que se pueda persistir ni comparar.
 */
export function requireFiniteNumber(value: unknown, code: string, what: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new DomainException(
      'NON_NUMERIC_DECISION_VALUE',
      `${what} de ${code} no produjo un número finito`,
    );
  }
  return parsed;
}

export interface MutableExecutionState {
  outcome: string;
  score?: number;
  riskBand?: string;
  limit?: number;
  output: Record<string, unknown>;
  reasons: DecisionReasonResult[];
  primaryResult?: EngineExecutionResult['primaryResult'];
  manualReview?: EngineExecutionResult['manualReview'];
  /**
   * Ámbito de las variables intermedias de ESTA ejecución. Vive en el estado, no en
   * el servicio: el servicio es un singleton compartido entre peticiones y ahí una
   * intermedia sobreviviría a su ejecución, que es justo lo que §2.1 prohíbe.
   */
  intermediates: IntermediateScope;
  /** Nodo en evaluación; determina qué intermedias son legibles y quién las consume. */
  currentNodeKey: string;
  /** Invocaciones a campos calculados de esta ejecución, en orden (§12). */
  calculatedFieldCalls: CalculatedFieldTraceEntry[];
  /** Llamadas a servicios de worker de esta ejecución, en orden. */
  workerCalls: WorkerCallTraceEntry[];
}

/** Lo que un nodo escribe sobre sí mismo durante su evaluación y la traza publica. */
export type NodeEvaluation = Record<string, unknown>;

/** Lo que cualquier ejecutor de nodo necesita saber de la ejecución en curso. */
export interface NodeScope {
  compiled: CompiledDecisionArtifact;
  variables: Record<string, unknown>;
  state: MutableExecutionState;
  evaluation: NodeEvaluation;
}

/** Las variables de salida que declara el contrato del artefacto. */
export function outputContractsOf(compiled: CompiledDecisionArtifact) {
  return compiled.variables.filter((variable) =>
    String(variable.usageType ?? '').startsWith('OUTPUT'),
  );
}

/** El contexto contra el que se evalúan expresiones y plantillas en el nodo en curso. */
export function evaluationContext(
  variables: Record<string, unknown>,
  state: MutableExecutionState,
): Record<string, unknown> {
  return {
    ...variables,
    variables,
    decision: {
      outcome: state.outcome,
      score: state.score,
      riskBand: state.riskBand,
      limit: state.limit,
      output: state.output,
    },
    output: state.output,
    // Espacio de nombres propio: las intermedias nunca se mezclan con las variables
    // del contrato, así una expresión no puede leer `dti` creyendo que es una entrada.
    intermediate: state.intermediates.readableView(state.currentNodeKey),
  };
}
