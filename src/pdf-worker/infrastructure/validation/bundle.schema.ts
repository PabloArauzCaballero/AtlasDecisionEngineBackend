/**
 * El contrato DEL PAQUETE: qué forma debe tener un template para que el backend lo acepte.
 *
 * Es un esquema sobre un esquema, y es lo que hace publicable el formato: de aquí sale el
 * JSON Schema que devuelve `GET /pdf/templates/format/schema`, así que quien integra no
 * descubre el formato leyendo este archivo ni copiándolo de una conversación — lo pregunta.
 *
 * Todos los topes son deliberados. Un `template` de diez megas o un `enum` de mil valores no
 * son casos de uso, son la forma barata de que el registro de templates deje de arrancar.
 */
import { z } from 'zod';
import {
  DOCUMENT_CLASSIFICATIONS,
  PAGE_FORMATS,
  PAGE_ORIENTATIONS,
} from '../../domain/enums/document.enums';
import { FIELD_TYPES } from '../../domain/contracts/template-bundle';
import {
  TEMPLATE_ID_PATTERN,
  TEMPLATE_VERSION_PATTERN,
} from '../../domain/value-objects/template-ref';

/** Nombre de campo utilizable desde Handlebars: sin puntos, sin guiones, sin espacios. */
const FIELD_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,60}$/;

/**
 * Descriptor de campo, recursivo.
 *
 * `z.lazy` es obligatorio aquí: un `array` de `object` de `array`… se describe a sí mismo, y
 * sin la referencia perezosa la definición no se puede escribir. La profundidad se acota más
 * abajo, al validar el paquete: un anidamiento sin fondo es una pila desbordada.
 */
export const FieldSpecSchema: z.ZodType<unknown> = z.lazy(() =>
  z.strictObject({
    type: z.enum(FIELD_TYPES),
    required: z.boolean().optional(),
    description: z.string().max(300).optional(),
    minLength: z.number().int().min(0).max(100_000).optional(),
    maxLength: z.number().int().min(1).max(100_000).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    values: z.array(z.string().min(1).max(80)).min(1).max(40).optional(),
    items: FieldSpecSchema.optional(),
    maxItems: z.number().int().min(1).max(5_000).optional(),
    fields: z.record(z.string().regex(FIELD_NAME), FieldSpecSchema).optional(),
  }),
);

export const TemplateManifestSchema = z.strictObject({
  id: z.string().regex(TEMPLATE_ID_PATTERN).min(3).max(64),
  version: z.string().regex(TEMPLATE_VERSION_PATTERN),
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(600),
  tags: z.array(z.string().min(1).max(40)).max(12).optional(),
  classification: z.enum(DOCUMENT_CLASSIFICATIONS).optional(),
  page: z
    .strictObject({
      format: z.enum(PAGE_FORMATS).optional(),
      orientation: z.enum(PAGE_ORIENTATIONS).optional(),
    })
    .optional(),
  footer: z
    .strictObject({
      institutionalText: z.string().max(160).optional(),
      showGeneratedAt: z.boolean().optional(),
      showDocumentId: z.boolean().optional(),
      showPageNumbers: z.boolean().optional(),
    })
    .optional(),
});

export const TemplateBundleSchema = z.strictObject({
  manifest: TemplateManifestSchema,
  fields: z
    .record(z.string().regex(FIELD_NAME), FieldSpecSchema)
    .refine((value) => Object.keys(value).length >= 1 && Object.keys(value).length <= 60, {
      message: 'El contrato debe declarar entre 1 y 60 campos de primer nivel.',
    }),
  // 256 KiB de plantilla y 128 KiB de estilos son holgadísimos para un documento: el informe
  // más grande del repositorio ocupa 3 KiB. El tope existe para que subir un template no sea
  // una vía para llenar el disco.
  template: z.string().min(1).max(262_144),
  styles: z.string().max(131_072).optional(),
  sample: z.unknown(),
});

export type TemplateBundleInput = z.infer<typeof TemplateBundleSchema>;

/** JSON Schema del paquete, para publicarlo tal cual en el endpoint de formato. */
export function bundleJsonSchema(): unknown {
  return z.toJSONSchema(TemplateBundleSchema, { io: 'input', unrepresentable: 'any' });
}
