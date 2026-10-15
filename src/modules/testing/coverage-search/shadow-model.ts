import { ExpressionEvaluator } from '../../graph/expression-evaluator';
import type { CompiledDecisionArtifact, WorkerCallSnapshot } from '../../graph/graph.types';
import { intermediateAssignmentsOf } from '../../graph/validators/graph-intermediate.validator';
import { parseWorkerCall } from '../../graph/worker-call';
import { referencedNames, variableName } from './expression-nodes';
import type { CoverageCandidate, Goal } from './types';

/** Niveles que se abre una cadena de fórmulas y de «si… si no…». Cada nivel abre dos ramas y una suele ser literal: lineal. */
export const MAX_INLINE_DEPTH = 64;

/**
 * Calcula, sin ejecutar el motor, lo que valdrían las intermedias con esta entrada y cuánto falta
 * para cumplir un objetivo.
 */
export class ShadowModel {
  private readonly evaluator = new ExpressionEvaluator();
  /** Fórmula de cada intermedia calculada por un nodo Expresión. */
  private readonly formulas = new Map<string, unknown>();
  private readonly workerOutputs: Array<{ nodeKey: string; call: WorkerCallSnapshot }> = [];
  /** Fórmulas en orden de dependencia: cada una después de las que lee. */
  private ordered: Array<[string, unknown]> = [];
  /** De qué depende cada intermedia que escribe un worker: la clave de su dimensión. */
  private readonly workerSources = new Map<string, string[]>();

  constructor(private readonly compiled: CompiledDecisionArtifact) {
    for (const node of Object.values(compiled.nodes)) {
      for (const assignment of intermediateAssignmentsOf(node)) {
        const code = typeof assignment.code === 'string' ? assignment.code : null;
        if (!code) continue;
        const source = String(assignment.source ?? 'EXPRESSION').toUpperCase();
        if (source === 'EXPRESSION' && assignment.expression !== undefined)
          this.formulas.set(code, assignment.expression);
        else if (source === 'LITERAL') this.formulas.set(code, { value: assignment.value });
      }
      if (node.type === 'WORKER') {
        const call = parseWorkerCall(node).call;
        if (call) {
          this.workerOutputs.push({ nodeKey: node.key, call });
          for (const output of call.outputs) {
            this.workerSources.set(output.intermediateCode, [
              `${node.key}#estado`,
              `${node.key}#${output.intermediateCode}`,
            ]);
          }
        }
      }
    }
    this.ordered = this.sortFormulas();
  }

  private sortFormulas(): Array<[string, unknown]> {
    const pending = new Map(this.formulas);
    const sorted: Array<[string, unknown]> = [];
    while (pending.size) {
      const ready = [...pending].filter(([, formula]) =>
        [...referencedNames(formula)].every(
          (name) =>
            !name.startsWith('intermediate.') || !pending.has(name.slice('intermediate.'.length)),
        ),
      );
      // Un ciclo no debería existir (el validador lo rechaza); si lo hay, se toma lo que queda tal cual.
      const batch = ready.length ? ready : [...pending];
      for (const entry of batch) {
        sorted.push(entry);
        pending.delete(entry[0]);
      }
    }
    return sorted;
  }

  /**
   * Las dimensiones de las que depende un objetivo, siguiendo las fórmulas hasta las entradas.
   * Una compuerta que mira dos variables se resuelve moviendo esas dos, no las cuarenta.
   */
  relevantDimensions(goals: Goal[]): Set<string> {
    const keys = new Set<string>();
    const seen = new Set<string>();
    const visit = (expression: unknown): void => {
      for (const name of referencedNames(expression)) {
        if (seen.has(name)) continue;
        seen.add(name);
        if (!name.startsWith('intermediate.')) {
          keys.add(name.split('.')[0]);
          continue;
        }
        const code = name.slice('intermediate.'.length).split('.')[0];
        (this.workerSources.get(code) ?? []).forEach((key) => keys.add(key));
        const formula = this.formulas.get(code);
        if (formula !== undefined) visit(formula);
      }
    };
    goals.forEach((goal) => visit(goal.expression));
    return keys;
  }

  context(candidate: CoverageCandidate): Record<string, unknown> {
    const intermediate: Record<string, unknown> = {};
    const context: Record<string, unknown> = {
      ...candidate.variables,
      variables: candidate.variables,
      decision: {},
      output: {},
      intermediate,
    };
    for (const { nodeKey, call } of this.workerOutputs) {
      const double = candidate.workerDoubles[nodeKey] ?? {};
      const failed = double.status === 'FAILED';
      const envelope = {
        ...context,
        result: failed ? {} : (double.result ?? {}),
        call: {
          status: failed ? 'FAILED' : 'SUCCEEDED',
          errorCode: failed ? (double.errorCode ?? 'WORKER_SERVICE_FAILED') : undefined,
        },
      };
      for (const output of call.outputs) {
        const raw = this.safe(
          output.source === 'EXPRESSION' ? output.expression : { var: output.path ?? '' },
          envelope,
        );
        intermediate[output.intermediateCode] =
          raw === undefined || raw === null ? (output.defaultValue ?? null) : raw;
      }
    }
    for (const [code, formula] of this.ordered) {
      const value = this.safe(formula, context);
      if (value !== undefined) intermediate[code] = value;
    }
    return context;
  }

  safe(expression: unknown, context: Record<string, unknown>): unknown {
    try {
      return this.evaluator.evaluate(expression, context);
    } catch {
      return undefined;
    }
  }

  /** La fórmula de una intermedia calculada, para sustituirla donde se la compara. */
  inline(expression: unknown, depth: number): unknown {
    if (depth > MAX_INLINE_DEPTH) return expression;
    const name = variableName(expression);
    if (name?.startsWith('intermediate.')) {
      const formula = this.formulas.get(name.slice('intermediate.'.length));
      if (formula !== undefined) return this.inline(formula, depth + 1);
    }
    return expression;
  }
}
