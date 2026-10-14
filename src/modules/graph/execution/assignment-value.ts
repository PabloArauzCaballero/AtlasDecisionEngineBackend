import type { ExpressionEvaluator } from '../expression-evaluator';
import { renderTemplate } from '../template-reference';

/**
 * El valor de una asignación declarada en un nodo (salida de un RESULT o intermedia).
 *
 * `source` decide de dónde sale: una expresión, la ruta de una variable, una plantilla o el
 * literal escrito en la propia asignación.
 */
export function assignmentValueOf(
  expressions: ExpressionEvaluator,
  assignment: Record<string, unknown>,
  context: Record<string, unknown>,
): unknown {
  const source = String(assignment.source ?? 'LITERAL').toUpperCase();
  if (source === 'EXPRESSION') {
    return expressions.evaluate(assignment.expression ?? assignment.valueExpression, context);
  }
  if (source === 'VARIABLE') {
    return expressions.evaluate(
      { var: String(assignment.variablePath ?? assignment.path ?? '') },
      context,
    );
  }
  if (source === 'TEMPLATE') return renderTemplate(assignment.value, context);
  return assignment.value;
}
