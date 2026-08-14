/**
 * Compila el vocabulario declarativo de un paquete a un validador Zod real.
 *
 * Éste es el punto donde un template SUBIDO alcanza exactamente la misma garantía que uno
 * incorporado: al final los dos son un `PayloadSchema<T>`, los dos rechazan con campo,
 * problema y regla, y los dos publican su contrato en `/schema`. La diferencia está en el
 * origen —código revisado frente a datos validados—, no en el rigor.
 *
 * La profundidad se acota. `z.lazy` permite describir un anidamiento infinito y compilarlo
 * costaría una pila desbordada durante el registro, es decir, un arranque que muere sin
 * explicar por qué: el tope convierte eso en un rechazo con mensaje.
 */
import { z } from 'zod';
import type { PayloadSchema } from '../../domain/contracts/template-contract';
import type { FieldSpec } from '../../domain/contracts/template-bundle';
import { TemplateSourceError } from '../../domain/errors/pdf-worker.errors';
import { zodSchema } from './zod-payload-schema';

/** Cinco niveles cubren «secciones → tablas → filas → celdas» con margen. */
const MAX_DEPTH = 5;

/** Techos por omisión cuando el paquete no los declara. Sin ellos no hay cota de trabajo. */
const DEFAULT_MAX_LENGTH = 2_000;
const DEFAULT_MAX_ITEMS = 500;

function compileOne(spec: FieldSpec, path: string, depth: number): z.ZodType {
  if (depth > MAX_DEPTH) {
    throw new TemplateSourceError(
      path,
      `el contrato anida más de ${MAX_DEPTH} niveles; simplifique la estructura.`,
    );
  }

  switch (spec.type) {
    case 'string': {
      let schema = z.string().max(spec.maxLength ?? DEFAULT_MAX_LENGTH);
      if (spec.minLength !== undefined) schema = schema.min(spec.minLength);
      return described(schema, spec);
    }
    case 'number':
    case 'integer': {
      let schema = spec.type === 'integer' ? z.number().int() : z.number();
      if (spec.min !== undefined) schema = schema.min(spec.min);
      if (spec.max !== undefined) schema = schema.max(spec.max);
      return described(schema, spec);
    }
    case 'boolean':
      return described(z.boolean(), spec);
    case 'date':
      // ISO-8601 y no `z.date()`: el payload llega por JSON, donde una fecha es una cadena.
      // `z.date()` rechazaría TODO lo que un cliente puede mandar realmente.
      return described(z.iso.datetime(), spec);
    case 'enum': {
      const values = spec.values ?? [];
      if (values.length === 0) {
        throw new TemplateSourceError(path, 'un campo «enum» debe declarar «values».');
      }
      return described(z.enum([...values] as [string, ...string[]]), spec);
    }
    case 'array': {
      if (!spec.items) {
        throw new TemplateSourceError(path, 'un campo «array» debe declarar «items».');
      }
      const items = compileOne(spec.items, `${path}[]`, depth + 1);
      return described(z.array(items).max(spec.maxItems ?? DEFAULT_MAX_ITEMS), spec);
    }
    case 'object': {
      if (!spec.fields || Object.keys(spec.fields).length === 0) {
        throw new TemplateSourceError(path, 'un campo «object» debe declarar «fields».');
      }
      return described(compileShape(spec.fields, path, depth + 1), spec);
    }
    default: {
      // El esquema del paquete ya restringe `type` al catálogo cerrado, así que llegar aquí
      // significa que el catálogo creció y este `switch` no. Falla en vez de pasar de largo.
      const desconocido: never = spec.type;
      throw new TemplateSourceError(path, `tipo de campo no soportado: ${String(desconocido)}`);
    }
  }
}

function described(schema: z.ZodType, spec: FieldSpec): z.ZodType {
  // La descripción no es decorativa: es lo que acaba en `GET /schema` y lo que lee quien tiene
  // que construir el payload sin poder preguntar a nadie.
  return spec.description ? schema.describe(spec.description) : schema;
}

function compileShape(
  fields: Readonly<Record<string, FieldSpec>>,
  path: string,
  depth: number,
): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const [name, spec] of Object.entries(fields)) {
    const compiled = compileOne(spec, path ? `${path}.${name}` : name, depth);
    shape[name] = spec.required ? compiled : compiled.optional();
  }
  // `strictObject`: una clave que el contrato no declara se rechaza. Es lo que convierte una
  // errata del llamante («titutlar») en un 422 con la ruta exacta y no en un hueco impreso.
  return z.strictObject(shape);
}

export function compileFieldSpecs(
  fields: Readonly<Record<string, FieldSpec>>,
): PayloadSchema<unknown> {
  return zodSchema(compileShape(fields, '', 1));
}
