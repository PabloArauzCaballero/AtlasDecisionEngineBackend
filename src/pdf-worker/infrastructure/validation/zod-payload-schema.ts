/**
 * Adaptador que convierte un esquema de Zod en el `PayloadSchema<T>` del dominio.
 *
 * Es la única pieza del worker que importa Zod. Cambiar de validador —a `typebox`, a
 * `@sinclair`, a `ajv` sobre JSON Schema— es escribir otro archivo como éste; ni el dominio,
 * ni los casos de uso, ni los templates se enteran, porque todos hablan con la interfaz de
 * tres métodos y no con `z`.
 *
 * `parse` devuelve el valor PARSEADO, no el original: es donde se aplican los valores por
 * omisión, las coerciones y los `transform` del contrato. Devolver el original haría que la
 * plantilla recibiese datos sin normalizar y que un `default` declarado no llegara nunca.
 */
import { z } from 'zod';
import type {
  PayloadParseResult,
  PayloadSchema,
  TemplateFieldDescriptor,
} from '../../domain/contracts/template-contract';
import { describeJsonSchema, requiredKeysOf } from './json-schema-fields';
import { toPayloadIssues } from './payload-issues';

export function zodSchema<TSchema extends z.ZodType>(
  schema: TSchema,
): PayloadSchema<z.output<TSchema>> {
  // Se calculan una vez y se memorizan: `toJSONSchema` recorre el árbol entero y el endpoint
  // de descubrimiento puede recibir tanto tráfico como la generación.
  let cachedJsonSchema: unknown;
  let cachedFields: Readonly<Record<string, TemplateFieldDescriptor>> | undefined;

  const jsonSchemaOf = (): unknown => {
    if (cachedJsonSchema === undefined) {
      // `io: 'input'` describe lo que hay que MANDAR, no lo que sale tras los `transform`;
      // `unrepresentable: 'any'` evita que un tipo sin equivalente en JSON Schema —una fecha
      // nativa, por ejemplo— tumbe el endpoint entero en lugar de degradar ese único campo.
      cachedJsonSchema = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
    }
    return cachedJsonSchema;
  };

  return {
    parse(input: unknown): PayloadParseResult<z.output<TSchema>> {
      const result = schema.safeParse(input);
      if (result.success) return { ok: true, value: result.data as z.output<TSchema> };
      return { ok: false, issues: toPayloadIssues(result.error.issues, input) };
    },
    describeFields() {
      cachedFields ??= describeJsonSchema(jsonSchemaOf());
      return cachedFields;
    },
    toJsonSchema: jsonSchemaOf,
    requiredFields() {
      return requiredKeysOf(jsonSchemaOf());
    },
  };
}
