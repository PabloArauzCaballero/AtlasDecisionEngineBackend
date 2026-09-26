/**
 * Descubrimiento de templates (§18, §19).
 *
 * Es la pieza que convierte esto en una plataforma y no en un endpoint: otro artefacto puede
 * PREGUNTAR qué documentos existen y qué datos necesita cada uno, en vez de que alguien lo
 * copie de una conversación a un DTO y se entere de que cambió cuando el PDF sale con huecos.
 */
import { Inject, Injectable } from '@nestjs/common';
import { summarize, type TemplateSummary } from '../../../domain/contracts/template-contract';
import { DEFAULT_PAGE_SETUP, mergePageSetup } from '../../../domain/value-objects/page-setup';
import type { TemplateDefinitionResult, TemplateSchemaResult } from '../../dto/generate-pdf.result';
import { BRAND_REPOSITORY_PORT, type BrandRepositoryPort } from '../../ports/brand-repository.port';
import {
  TEMPLATE_REPOSITORY_PORT,
  type TemplateRepositoryPort,
} from '../../ports/template-repository.port';

@Injectable()
export class GetTemplateDefinitionUseCase {
  constructor(
    @Inject(TEMPLATE_REPOSITORY_PORT) private readonly templates: TemplateRepositoryPort,
    @Inject(BRAND_REPOSITORY_PORT) private readonly brands: BrandRepositoryPort,
  ) {}

  list(tag?: string): readonly TemplateSummary[] {
    return this.templates
      .listTemplates()
      .filter((contract) => !tag || (contract.tags ?? []).includes(tag))
      .map(summarize);
  }

  definition(templateId: string, version?: string): TemplateDefinitionResult {
    const contract = this.templates.getTemplate(templateId, version);
    // La geometría publicada es la EFECTIVA con la marca por defecto, no la que declara el
    // template: un consumidor que planifica un anexo necesita saber en qué hoja saldrá de
    // verdad, y la marca puede haber impuesto otra.
    const page = mergePageSetup(DEFAULT_PAGE_SETUP, this.brands.getDefault().page, contract.page);
    return {
      ...summarize(contract),
      versions: this.templates.listVersions(contract.id),
      page: {
        format: page.format,
        orientation: page.orientation,
        margins: { ...page.margins },
        printBackground: page.printBackground,
      },
      assets: contract.assets ?? [],
    };
  }

  schema(templateId: string, version?: string): TemplateSchemaResult {
    const contract = this.templates.getTemplate(templateId, version);
    return {
      templateId: contract.id,
      version: contract.version,
      title: contract.title,
      description: contract.description,
      fields: contract.schema.describeFields(),
      jsonSchema: contract.schema.toJsonSchema(),
      // El ejemplo es el MISMO `fixture` que usa la vista previa: si deja de ser válido, la
      // vista previa se rompe y alguien se entera. Un ejemplo escrito aparte envejece solo.
      example: contract.fixture(),
    };
  }

  versions(templateId: string): readonly string[] {
    return this.templates.listVersions(templateId);
  }
}
