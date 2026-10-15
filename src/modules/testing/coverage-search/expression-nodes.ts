/** Lectura de los nodos de expresión del grafo: variables, literales y nombres referenciados. */

export const COMPARISONS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function variableName(node: unknown): string | null {
  if (!isRecord(node)) return null;
  const raw =
    typeof node.var === 'string'
      ? node.var
      : typeof node.variable === 'string'
        ? node.variable
        : null;
  if (!raw) return null;
  return raw.startsWith('variables.') ? raw.slice('variables.'.length) : raw;
}

export function isLiteral(node: unknown): boolean {
  if (node === null || ['string', 'number', 'boolean'].includes(typeof node)) return true;
  // Una lista escrita tal cual (`x in ["A", "B"]`) también es un literal.
  if (Array.isArray(node)) return node.every((item) => item === null || typeof item !== 'object');
  return isRecord(node) && 'value' in node && !('op' in node);
}

export function literalValue(node: unknown): unknown {
  return isRecord(node) ? node.value : node;
}

export function referencedNames(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((item) => referencedNames(item, found));
  else if (isRecord(node)) {
    const name = variableName(node);
    if (name) found.add(name);
    Object.values(node).forEach((item) => referencedNames(item, found));
  }
  return found;
}
