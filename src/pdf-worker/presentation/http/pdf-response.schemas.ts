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
import type { ArtifactSummary } from '../../application/ports/artifact-contract.port';

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

/*
 * ─── Administración y documentación del formato ──────────────────────────────
 *
 * Siete operaciones respondían sin declarar el cuerpo. `docs:openapi:check` lo trata como fallo
 * duro y sin deuda admitida, y con razón: un endpoint cuyo contrato no dice qué devuelve obliga
 * a quien integra a leerse el código del servidor, que es exactamente lo que un contrato
 * publicado existe para evitar. La parte cara no es escribir esto — es descubrir a mitad de una
 * integración que el campo que esperabas se llama de otra forma.
 */

/** El JSON Schema del formato de paquete. `unknown` porque su forma la fija JSON Schema. */
export const TemplateFormatSchemaResponseSchema = z.object({
  format: z.string(),
  jsonSchema: z.unknown(),
});

const errorCatalogEntry = z.object({
  code: z.string(),
  httpStatus: z.number(),
  title: z.string(),
  meaning: z.string(),
  cause: z.string(),
  remedy: z.string(),
  retryable: z.boolean(),
  audience: z.enum(['consumidor', 'operador', 'ambos']),
});

export const ErrorCatalogResponseSchema = z.object({ errors: z.array(errorCatalogEntry) });

const storedTemplate = z.object({
  templateId: z.string(),
  version: z.string(),
  title: z.string(),
  status: z.string(),
  createdAt: z.string(),
  createdBy: z.string().optional(),
  checksum: z.string().optional(),
});

/** Una entrada del inventario: un template guardado, más de dónde vino. */
const inventoryEntry = storedTemplate.extend({
  // `origin` decide si algo se puede tocar por la API, así que va declarado y CERRADO: un
  // consumidor que lo leyera como texto libre acabaría intentando borrar un incorporado y
  // recibiendo un 403 que su código no espera.
  origin: z.enum(['builtin', 'api']),
});

export const TemplateInventoryResponseSchema = z.object({ templates: z.array(inventoryEntry) });

export const StoredTemplateResponseSchema = storedTemplate;

/**
 * El paquete de template, tal cual se subió.
 *
 * Objeto abierto a propósito: su forma la gobierna el JSON Schema que publica
 * `GET /pdf/template-format/schema`, y duplicarla aquí crearía una segunda descripción del
 * mismo formato que envejecería por su cuenta. Lo que se promete es que es un objeto JSON.
 */
export const TemplateBundleResponseSchema = z.looseObject({});

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

/**
 * Artefactos disponibles para casar con un documento.
 *
 * `outputFieldCount` es lo que hace utilizable la lista: un artefacto que publica tres campos y
 * otro que publica cuarenta se eligen distinto, y sin el número hay que abrir cada uno para
 * saberlo.
 */
const artifactSummary = z.object({
  artifactId: z.string(),
  artifactVersion: z.string(),
  title: z.string(),
  outputFieldCount: z.number(),
}) satisfies z.ZodType<ArtifactSummary>;

export const ArtifactBindingListResponseSchema = z.object({
  artifacts: z.array(artifactSummary),
});
