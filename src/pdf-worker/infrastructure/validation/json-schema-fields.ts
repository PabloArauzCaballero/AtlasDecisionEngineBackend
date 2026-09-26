/**
 * Convierte un JSON Schema en el mapa legible que publica `GET /pdf/templates/:id/schema`.
 *
 * Se deriva del JSON Schema y no de las tripas de Zod a propósito. Recorrer `_def` funciona
 * hasta que el validador publica una versión menor y cambia una estructura interna que nunca
 * prometió: entonces el endpoint que otros artefactos usan para descubrir qué mandar se queda
 * mudo, y el fallo aparece lejos de la actualización que lo causó. El JSON Schema sí es un
 * contrato público, del validador y de este código.
 */
import type { TemplateFieldDescriptor } from '../../domain/contracts/template-contract';

type JsonSchemaNode = Record<string, unknown>;

function asNode(value: unknown): JsonSchemaNode | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonSchemaNode)
    : undefined;
}

function typeNameOf(node: JsonSchemaNode): string {
  if (Array.isArray(node.enum)) return 'enum';
  const type = node.type;
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) return type.map(String).join(' | ');
  const variants = node.anyOf ?? node.oneOf;
  if (Array.isArray(variants)) {
    const names = variants
      .map((variant) => asNode(variant))
      .filter((variant): variant is JsonSchemaNode => variant !== undefined)
      .map(typeNameOf);
    return [...new Set(names)].join(' | ') || 'any';
  }
  if (node.const !== undefined) return 'const';
  return 'any';
}

function describeNode(node: JsonSchemaNode, required: boolean): TemplateFieldDescriptor {
  const type = typeNameOf(node);
  const descriptor: {
    type: string;
    required: boolean;
    description?: string;
    values?: readonly string[];
    items?: TemplateFieldDescriptor;
    fields?: Record<string, TemplateFieldDescriptor>;
  } = { type, required };

  if (typeof node.description === 'string') descriptor.description = node.description;
  if (Array.isArray(node.enum)) descriptor.values = node.enum.map((value) => String(value));

  const items = asNode(node.items);
  if (items) descriptor.items = describeNode(items, true);

  const properties = asNode(node.properties);
  if (properties) {
    const requiredKeys = new Set(
      Array.isArray(node.required) ? node.required.map((key) => String(key)) : [],
    );
    descriptor.fields = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => {
        const child = asNode(value);
        return [
          key,
          child ? describeNode(child, requiredKeys.has(key)) : { type: 'any', required: false },
        ];
      }),
    );
  }
  return descriptor;
}

/** Mapa de campos de primer nivel; cada uno describe recursivamente su propia forma. */
export function describeJsonSchema(
  schema: unknown,
): Readonly<Record<string, TemplateFieldDescriptor>> {
  const root = asNode(schema);
  const properties = root ? asNode(root.properties) : undefined;
  if (!root || !properties) return {};
  const requiredKeys = new Set(
    Array.isArray(root.required) ? root.required.map((key) => String(key)) : [],
  );
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => {
      const child = asNode(value);
      return [
        key,
        child ? describeNode(child, requiredKeys.has(key)) : { type: 'any', required: false },
      ];
    }),
  );
}

export function requiredKeysOf(schema: unknown): readonly string[] {
  const root = asNode(schema);
  return Array.isArray(root?.required) ? root.required.map((key) => String(key)) : [];
}
