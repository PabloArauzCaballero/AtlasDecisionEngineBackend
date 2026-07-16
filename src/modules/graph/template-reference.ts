const TEMPLATE_REFERENCE_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;

export function renderTemplate(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    return value.replace(TEMPLATE_REFERENCE_PATTERN, (_match, path: string) => {
      const resolved = path.split('.').reduce<unknown>((current, key) => {
        if (current && typeof current === 'object') return (current as Record<string, unknown>)[key];
        return undefined;
      }, context);
      return resolved == null ? '' : String(resolved);
    });
  }
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, context));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, renderTemplate(item, context)]),
    );
  }
  return value;
}

/** Extracts the raw `path` from each `{{ path }}` placeholder found anywhere inside `value`. */
export function extractTemplateReferences(value: unknown): string[] {
  const serialized = JSON.stringify(value);
  if (!serialized) return [];
  const paths: string[] = [];
  for (const match of serialized.matchAll(TEMPLATE_REFERENCE_PATTERN)) {
    paths.push(match[1]);
  }
  return paths;
}
