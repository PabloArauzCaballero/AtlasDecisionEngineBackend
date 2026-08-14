/**
 * Contrato del CUERPO de la respuesta.
 *
 * Vive aparte de `pdf-request.schemas.ts` porque describe lo contrario: aquello a lo que este
 * servicio se compromete, no lo que exige. Se publica con `openApiResponseSchemaOf`, que sólo
 * se diferencia en `io: 'output'` — un campo con valor por omisión es opcional al ENTRAR y
 * seguro al SALIR, y describirlo con el dialecto de entrada haría que un consumidor tratara
 * como opcional algo que siempre llega.
 *
 * Los esquemas están atados a los tipos que devuelven los casos de uso mediante
 * `satisfies z.ZodType<T>`: si alguien añade un campo a `GeneratedDocument` y no lo declara
 * aquí, no se publica un contrato desactualizado en silencio — deja de compilar.
 */
import type { ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';
import {
  DOCUMENT_CLASSIFICATIONS,
  GENERATION_STATUSES,
  PDF_MIME_TYPE,
} from '../../domain/enums/document.enums';
import type { GeneratedDocument } from '../../domain/entities/generated-document';
import type { TemplateSummary } from '../../domain/contracts/template-contract';

const classification = z.enum(DOCUMENT_CLASSIFICATIONS);

const templateSummary = z.object({
  id: z.string(),
  version: z.string(),
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  classification: classification.optional(),
  requiredFields: z.array(z.string()),
  deprecated: z
    .object({
      since: z.string(),
      reason: z.string(),
      replacedBy: z.string().optional(),
    })
    .optional(),
}) satisfies z.ZodType<TemplateSummary>;

/**
 * La ficha del documento TAL COMO SALE por HTTP, sin `content`.
 *
 * El búfer nunca viaja dentro del JSON: cuando se pide el archivo se responde el binario
 * (`Accept: application/pdf`), y en modo asíncrono no se devuelve nada del contenido. Declarar
 * aquí un campo `content` describiría una respuesta que este servicio no emite.
 */
const generatedDocument = z.object({
  documentId: z.string(),
  template: z.object({ id: z.string(), version: z.string() }),
  filename: z.string(),
  mimeType: z.literal(PDF_MIME_TYPE),
  sizeBytes: z.number(),
  checksum: z.string(),
  createdAt: z.string(),
  status: z.enum(GENERATION_STATUSES),
  classification: classification.optional(),
  brandId: z.string(),
  storage: z
    .object({ provider: z.string(), key: z.string(), url: z.string().optional() })
    .optional(),
  trace: z.object({
    correlationId: z.string().optional(),
    requestedBy: z.string().optional(),
    idempotencyKey: z.string().optional(),
    renderer: z.string(),
    renderDurationMs: z.number(),
    pageCount: z.number().optional(),
  }),
}) satisfies z.ZodType<GeneratedDocument>;

export const TemplateListResponseSchema = z.object({ templates: z.array(templateSummary) });

export const TemplateVersionsResponseSchema = z.object({
  templateId: z.string(),
  versions: z.array(z.string()),
});

export const GeneratedDocumentResponseSchema = generatedDocument;

export const QueuedGenerationResponseSchema = z.object({
  jobId: z.string(),
  queuedAhead: z.number(),
  status: z.literal('QUEUED'),
});

/**
 * El tipo de `content` se DERIVA del propio decorador.
 *
 * `ContentObject` sólo se exporta desde `@nestjs/swagger/dist/interfaces/...`, y apuntar a la
 * carpeta compilada de una dependencia es un enlace que se rompe en la siguiente versión menor
 * sin que nada avise. Leerlo de la firma pública de `ApiResponse` da el mismo tipo y sigue a
 * Nest si lo cambia.
 */
type ApiContent = NonNullable<Parameters<typeof ApiResponse>[0]['content']>;

/** Esquemas en el dialecto de OpenAPI 3.0, en su forma de SALIDA. */
export function openApiResponseSchemaOf(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'output',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
}

/**
 * Cuerpo `application/json` listo para `@ApiResponse`.
 *
 * La conversión es inevitable y está acotada aquí: el emisor de Zod produce un objeto JSON
 * Schema válido, pero su tipo estático es un diccionario abierto y TypeScript no puede
 * comprobar que encaje en `SchemaObject`. Se hace UNA vez, en la frontera, en lugar de
 * repartir `as` por cada controlador.
 */
export function jsonBody(schema: z.ZodType): ApiContent {
  return { 'application/json': { schema: openApiResponseSchemaOf(schema) } } as ApiContent;
}

/**
 * Cuerpo binario. El archivo no tiene «forma» que describir más allá de que son bytes, y eso
 * es exactamente lo que dice `format: binary`: no es un esquema aproximado, es el esquema.
 */
export const pdfBody: ApiContent = {
  [PDF_MIME_TYPE]: { schema: { type: 'string', format: 'binary' } },
};
