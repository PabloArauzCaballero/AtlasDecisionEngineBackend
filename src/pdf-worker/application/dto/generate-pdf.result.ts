/**
 * La salida universal (§16).
 *
 * `content` viaja sólo cuando quien llama lo pidió. En el modo asíncrono el búfer NO entra en
 * el mensaje: un PDF de dos megas dentro de una cola es una cola que revienta, y el
 * consumidor ya tiene la clave de almacenamiento para recogerlo.
 */
import type { GeneratedDocument } from '../../domain/entities/generated-document';
import type { PayloadIssue } from '../../domain/errors/pdf-worker.errors';
import type {
  TemplateFieldDescriptor,
  TemplateSummary,
} from '../../domain/contracts/template-contract';

export interface GeneratePdfResult extends GeneratedDocument {
  /** Presente sólo si `options.returnContent !== false`. */
  readonly content?: Buffer;
}

export interface ValidatePayloadResult {
  readonly valid: boolean;
  readonly templateId: string;
  readonly version: string;
  readonly issues: readonly PayloadIssue[];
}

/** Respuesta de `GET /pdf/templates/:id/schema` (§19). */
export interface TemplateSchemaResult {
  readonly templateId: string;
  readonly version: string;
  readonly title: string;
  readonly description: string;
  readonly fields: Readonly<Record<string, TemplateFieldDescriptor>>;
  /** JSON Schema 2020-12 completo, para validar del lado del consumidor. */
  readonly jsonSchema: unknown;
  readonly example: unknown;
}

export interface TemplateDefinitionResult extends TemplateSummary {
  readonly versions: readonly string[];
  readonly page: {
    readonly format: string;
    readonly orientation: string;
    readonly margins: Readonly<Record<string, string>>;
    readonly printBackground: boolean;
  };
  readonly assets: readonly string[];
}
