import type { CompiledDecisionArtifact } from '../../graph/graph.types';
import {
  COMPARISONS,
  isLiteral,
  isRecord,
  literalValue,
  referencedNames,
} from './expression-nodes';

/**
 * Los literales con que el grafo compara cada variable: `x > 0.4`, `x == "VERIFIED"`,
 * `x in ["DPD_30", …]`, y también `coalesce(x, 0) >= 2`. Son los puntos donde la decisión cambia.
 */
export function comparedLiterals(compiled: CompiledDecisionArtifact): Map<string, unknown[]> {
  const found = new Map<string, unknown[]>();
  const add = (name: string, value: unknown) => {
    const list = found.get(name) ?? [];
    if (!list.some((item) => JSON.stringify(item) === JSON.stringify(value))) list.push(value);
    found.set(name, list);
  };
  const attribute = (side: unknown, value: unknown) => {
    // El lado que no es literal puede ser la variable o una envoltura de UNA variable.
    const names = [...referencedNames(side)];
    if (names.length === 1) add(names[0], value);
  };
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!isRecord(value)) return;
    const op = typeof value.op === 'string' ? value.op.toLowerCase() : null;
    const args = Array.isArray(value.args) ? value.args : [];
    const left: unknown = value.left ?? args[0];
    const right: unknown = value.right ?? args[1];
    if (op && COMPARISONS.has(op)) {
      if (isLiteral(right)) attribute(left, literalValue(right));
      if (isLiteral(left)) attribute(right, literalValue(left));
    }
    if ((op === 'in' || op === 'not_in') && isLiteral(right)) {
      const options = literalValue(right);
      if (Array.isArray(options)) options.forEach((item) => attribute(left, item));
    }
    Object.values(value).forEach(walk);
  };
  Object.values(compiled.conditions).forEach((condition) => walk(condition.expression));
  Object.values(compiled.nodes).forEach((node) => walk(node.config));
  return found;
}
