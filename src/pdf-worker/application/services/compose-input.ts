/**
 * Resuelve, en un solo sitio, todo lo que hace falta para componer un documento.
 *
 * Lo usan el caso de uso de generación y el de composición de HTML (el que alimenta la
 * regresión visual). Que sea UNA función es lo que hace que la huella visual mida el mismo
 * documento que se genera de verdad: con dos resoluciones paralelas, la referencia acabaría
 * midiendo una combinación de marca y geometría que ninguna petición produce.
 */
import type { TemplateContract } from '../../domain/contracts/template-contract';
import type { DocumentBrand } from '../../domain/value-objects/document-brand';
import type { GenerationMetadata, GenerationOptions } from '../dto/generate-pdf.command';
import type { PdfWorkerSettings } from '../ports/settings.port';
import {
  resolveClassification,
  resolveFooter,
  resolveLetterhead,
  resolvePageSetup,
} from './config-precedence';
import type { ComposeInput } from './document-composer';
import { resolveLocale, resolveTimezone } from './formatting';

export interface CompositionRequest {
  readonly contract: TemplateContract;
  readonly brand: DocumentBrand;
  readonly data: unknown;
  readonly documentId: string;
  readonly createdAt: Date;
  readonly metadata?: GenerationMetadata;
  readonly options?: GenerationOptions;
  readonly settings: PdfWorkerSettings;
}

export function buildComposeInput(request: CompositionRequest): ComposeInput {
  const { contract, brand, metadata, options, settings } = request;
  const classification = resolveClassification(brand, contract, options?.classification);
  return {
    contract,
    brand,
    letterhead: resolveLetterhead(brand, contract),
    footer: resolveFooter(brand, contract, classification),
    page: resolvePageSetup(brand, contract, options),
    data: request.data,
    documentId: request.documentId,
    createdAt: request.createdAt,
    classification,
    locale: resolveLocale(metadata?.locale ?? settings.defaultLocale),
    timezone: resolveTimezone(metadata?.timezone ?? settings.defaultTimezone),
    requestedBy: metadata?.requestedBy,
    correlationId: metadata?.correlationId,
  };
}
