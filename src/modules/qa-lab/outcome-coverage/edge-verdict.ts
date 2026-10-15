import type { ExpressionEvaluator } from '../../graph/expression-evaluator';
import type { CompiledDecisionArtifact, GraphEdgeSnapshot } from '../../graph/graph.types';

/**
 * Qué ramas del camino NO quedan garantizadas por la entrada construida.
 *
 * Se distinguen dos cosas que no son lo mismo: una condición que se puede evaluar y sale
 * mal (la entrada no consigue el desvío) y una que no se puede evaluar porque lee un
 * valor que produce el propio grafo. La primera es un fallo del ajuste; la segunda es un
 * límite del método, y mezclarlas dejaría al analista sin saber cuál de las dos mira.
 */
export function verifyPath(
  compiled: CompiledDecisionArtifact,
  evaluator: ExpressionEvaluator,
  path: string[],
  input: Record<string, unknown>,
): string[] {
  const problems: string[] = [];
  for (let step = 0; step < path.length - 1; step += 1) {
    const edges = compiled.edgesByNode[path[step]] ?? [];
    const taken = edges.find((edge) => edge.to === path[step + 1]);
    if (!taken) continue;

    for (const edge of edges) {
      if (edge.key === taken.key) break;
      if (edge.default) continue;
      const { verdict, blame } = edgeVerdict(compiled, evaluator, edge, input);
      if (verdict === true) {
        problems.push(
          `${edge.key}: se cumple antes que «${taken.key}», así que la ejecución se desviaría`,
        );
      }
      if (verdict === null) {
        problems.push(`«${blame}» lo calcula el grafo: no se puede descartar la rama ${edge.key}`);
      }
    }

    if (taken.default || !taken.conditions.length) continue;
    const { verdict, blame } = edgeVerdict(compiled, evaluator, taken, input);
    if (verdict === false) {
      problems.push(`${taken.key}: «${blame}» no se cumple con los valores elegidos`);
    }
    if (verdict === null) {
      problems.push(
        `«${blame}» lo calcula el grafo, no la entrada: la rama ${taken.key} no está garantizada`,
      );
    }
  }
  return problems;
}

/**
 * `true`/`false` si la entrada lo decide; `null` si depende del propio grafo. `blame`
 * nombra la condición responsable, que es lo que el analista necesita para ir a mirarla.
 */
function edgeVerdict(
  compiled: CompiledDecisionArtifact,
  evaluator: ExpressionEvaluator,
  edge: GraphEdgeSnapshot,
  input: Record<string, unknown>,
): { verdict: boolean | null; blame?: string } {
  let blame: string | undefined;
  for (const reference of edge.conditions) {
    const expression = compiled.conditions[reference.code]?.expression;
    if (!expression) return { verdict: null, blame: reference.code };
    if (!governableFromInput(evaluator, expression, input)) {
      blame ??= reference.code;
      continue;
    }
    try {
      // Una sola condición falsa basta para que la arista no se tome, la evalúe quien la
      // evalúe: ahí ya no importa lo que no se pueda determinar.
      if (!evaluator.evaluate(expression, contextOf(input))) {
        return { verdict: false, blame: reference.code };
      }
    } catch {
      blame ??= reference.code;
    }
  }
  return blame ? { verdict: null, blame } : { verdict: true };
}

/**
 * ¿La expresión se decide sólo con el payload? `intermediate.*`, `decision.*` y
 * `output.*` los escribe el grafo durante la ejecución: evaluarlos aquí daría `undefined`
 * y una comparación falsa que parecería un veredicto firme.
 */
function governableFromInput(
  evaluator: ExpressionEvaluator,
  expression: unknown,
  input: Record<string, unknown>,
): boolean {
  for (const reference of evaluator.referencedVariables(expression)) {
    if (reference.startsWith('intermediate.')) return false;
    if (reference === 'decision' || reference === 'output') return false;
    if (!(reference in input)) return false;
  }
  return true;
}

/** Mismo contexto que arma el motor al evaluar una condición, con lo que hay: la entrada. */
function contextOf(input: Record<string, unknown>): Record<string, unknown> {
  return { ...input, variables: input, decision: {}, output: {}, intermediate: {} };
}
