/**
 * Contrato del SOBRE de la petición: qué template, para quién y con qué opciones.
 *
 * Es distinto del contrato del payload —que lo pone cada template— y se valida antes. La
 * separación importa: un `templateId` mal escrito debe dar 404 con la lista de templates
 * existentes, no 422 con «el payload no cumple el contrato de un template que no existe».
 *
 * `payload` se declara `z.unknown()` A PROPÓSITO. Es lo único de toda la petición que este
 * esquema no valida, porque quien sabe validarlo es el template; validarlo dos veces con dos
 * reglas distintas es cómo se acaba aceptando aquí lo que allí se rechaza.
 *
 * Todo lo demás es estricto. Las claves desconocidas se rechazan, y ése es el mecanismo que
 * cierra el §13: `{"options":{"scale":3}}` no se ignora, se contesta.
 */
import { z } from 'zod';
import {
  DOCUMENT_CLASSIFICATIONS,
  PAGE_FORMATS,
  PAGE_ORIENTATIONS,
} from '../../domain/enums/document.enums';
import { DOCUMENT_ID_PATTERN } from '../../domain/entities/generated-document';
import {
  TEMPLATE_ID_PATTERN,
  TEMPLATE_VERSION_PATTERN,
} from '../../domain/value-objects/template-ref';

const templateId = z.string().regex(TEMPLATE_ID_PATTERN).min(3).max(64);
const templateVersion = z.string().regex(TEMPLATE_VERSION_PATTERN);

const metadata = z.strictObject({
  documentId: z.string().regex(DOCUMENT_ID_PATTERN).optional(),
  correlationId: z.string().min(1).max(120).optional(),
  requestedBy: z.string().min(1).max(160).optional(),
  locale: z.string().min(2).max(20).optional(),
  timezone: z.string().min(2).max(60).optional(),
  idempotencyKey: z.string().min(8).max(200).optional(),
});

/**
 * Sólo las opciones sobrescribibles del §13.
 *
 * Que el esquema sea `strictObject` es lo que convierte «protegido» en algo comprobable: no
 * hay que mantener una lista negra al día, es que cualquier clave que no esté aquí se rechaza
 * por construcción.
 */
const options = z.strictObject({
  persist: z.boolean().optional(),
  filename: z.string().min(1).max(160).optional(),
  classification: z.enum(DOCUMENT_CLASSIFICATIONS).optional(),
  returnContent: z.boolean().optional(),
  page: z
    .strictObject({
      format: z.enum(PAGE_FORMATS).optional(),
      orientation: z.enum(PAGE_ORIENTATIONS).optional(),
    })
    .optional(),
});

export const GeneratePdfRequestSchema = z.strictObject({
  templateId,
  templateVersion: templateVersion.optional(),
  payload: z.unknown(),
  brandId: z.string().min(1).max(40).optional(),
  metadata: metadata.optional(),
  options: options.optional(),
});

export const PreviewRequestSchema = z.strictObject({
  templateId,
  templateVersion: templateVersion.optional(),
  brandId: z.string().min(1).max(40).optional(),
  payload: z.unknown().optional(),
  locale: z.string().min(2).max(20).optional(),
  timezone: z.string().min(2).max(60).optional(),
});

export const ValidatePayloadRequestSchema = z.strictObject({
  templateVersion: templateVersion.optional(),
  payload: z.unknown(),
});

export type GeneratePdfRequest = z.infer<typeof GeneratePdfRequestSchema>;
export type PreviewRequest = z.infer<typeof PreviewRequestSchema>;
export type ValidatePayloadRequest = z.infer<typeof ValidatePayloadRequestSchema>;

/** Esquemas en el dialecto que entiende OpenAPI 3.0, para publicarlos sin escribirlos dos veces. */
export function openApiSchemaOf(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
}
