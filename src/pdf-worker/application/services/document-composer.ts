/**
 * Convierte «contrato + marca + datos» en el HTML autocontenido que se manda a imprimir.
 *
 * Es el §10 hecho código: el layout base pone el armazón —membrete, pie, tipografía,
 * márgenes, numeración— y el template de negocio sólo aporta el contenido. Un template que
 * tuviera que escribir su propio `<html>` acabaría, a la tercera copia, con tres membretes
 * ligeramente distintos.
 *
 * El HTML que sale de aquí no referencia NADA externo: ni hoja de estilo, ni fuente, ni
 * imagen por URL. Todo va embebido. Eso es lo que hace cierto el §25 —mismo template, misma
 * versión, mismo payload, mismo documento— y lo que cierra la vía de SSRF del §24.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { TemplateContract } from '../../domain/contracts/template-contract';
import type { DocumentClassification } from '../../domain/enums/document.enums';
import { CLASSIFICATION_LABELS } from '../../domain/enums/document.enums';
import type {
  DocumentBrand,
  FooterConfig,
  LetterheadConfig,
} from '../../domain/value-objects/document-brand';
import type { PageSetup } from '../../domain/value-objects/page-setup';
import { TemplateRenderError } from '../../domain/errors/pdf-worker.errors';
import { ASSET_RESOLVER_PORT, type AssetResolverPort } from '../ports/asset-resolver.port';
import {
  FONT_PROVIDER_PORT,
  type FontFaceBundle,
  type FontProviderPort,
} from '../ports/font-provider.port';
import { TEMPLATE_ENGINE_PORT, type TemplateEnginePort } from '../ports/template-engine.port';
import {
  TEMPLATE_SOURCE_LOADER_PORT,
  type TemplateSourceLoaderPort,
} from '../ports/template-source-loader.port';
import { brandTokensCss } from './brand-tokens';
import { formatDateTime } from './formatting';

export interface ComposeInput {
  readonly contract: TemplateContract;
  readonly brand: DocumentBrand;
  readonly letterhead: LetterheadConfig;
  readonly footer: FooterConfig;
  readonly page: PageSetup;
  /** Payload YA validado y normalizado por el contrato del template. */
  readonly data: unknown;
  readonly documentId: string;
  readonly createdAt: Date;
  readonly classification?: DocumentClassification;
  readonly locale: string;
  readonly timezone: string;
  readonly requestedBy?: string;
  readonly correlationId?: string;
}

export interface ComposedDocument {
  readonly html: string;
  readonly headerHtml: string;
  readonly footerHtml: string;
}

@Injectable()
export class DocumentComposer {
  constructor(
    @Inject(TEMPLATE_ENGINE_PORT) private readonly engine: TemplateEnginePort,
    @Inject(TEMPLATE_SOURCE_LOADER_PORT) private readonly loader: TemplateSourceLoaderPort,
    @Inject(ASSET_RESOLVER_PORT) private readonly assets: AssetResolverPort,
    @Inject(FONT_PROVIDER_PORT) private readonly fonts: FontProviderPort,
  ) {}

  async compose(input: ComposeInput): Promise<ComposedDocument> {
    const { contract } = input;
    const [shared, document, fonts] = await Promise.all([
      this.loader.loadShared(),
      this.loader.loadDocument(contract),
      this.fonts.load(),
    ]);

    for (const [name, source] of Object.entries(shared.partials)) {
      if (!this.engine.hasPartial(`atlas/${name}`))
        this.engine.registerPartial(`atlas/${name}`, source);
    }
    const documentScope = `${contract.id}@${contract.version}`;
    for (const [name, source] of Object.entries(document.partials)) {
      const qualified = `${documentScope}/${name}`;
      if (!this.engine.hasPartial(qualified)) this.engine.registerPartial(qualified, source);
    }

    const context = await this.buildContext(input, fonts);
    try {
      const body = this.engine
        .compile(`${documentScope}:body`, document.body)
        .render({ ...context, __scope: documentScope });
      const html = this.engine.compile('shared:layout', shared.layout).render({
        ...context,
        styles: `${shared.css}\n${document.css}`,
        content: body,
      });
      // La banda corrida del margen superior SÓLO la emite `every-page`. Con `first-page` el
      // membrete completo del cuerpo ya identifica el documento y repetir una segunda
      // identificación en cada hoja sería ruido; con `none`, no hay ninguna.
      const runningHeader = input.letterhead.mode === 'every-page';
      return {
        html,
        headerHtml: runningHeader
          ? this.engine.compile('shared:header', shared.header).render(context)
          : '',
        footerHtml: this.engine.compile('shared:footer', shared.footer).render(context),
      };
    } catch (error) {
      if (error instanceof TemplateRenderError) throw error;
      throw new TemplateRenderError(
        contract.id,
        error instanceof Error ? error.message : String(error),
        error,
      );
    }
  }

  /**
   * Contexto que ven las plantillas.
   *
   * El payload vive bajo `data` y no en la raíz. Es un grado más de escritura —`{{data.title}}`
   * en vez de `{{title}}`— a cambio de que un payload con un campo llamado `document` o
   * `brand` no pueda suplantar los metadatos del propio informe.
   */
  private async buildContext(
    input: ComposeInput,
    fonts: FontFaceBundle,
  ): Promise<Record<string, unknown>> {
    const logoDataUri = input.letterhead.logo
      ? (await this.assets.resolve(input.letterhead.logo)).dataUri
      : undefined;

    return {
      tokens: `${fonts.css}\n${brandTokensCss(input.brand, fonts)}`,
      /**
       * El membrete y el pie corridos se pintan en un DOCUMENTO APARTE del navegador: no ven
       * el `<style>` de la página, así que ni `var(--ink)` ni la fuente embebida existen ahí.
       * Por eso van los valores literales (`colors`, `type`) y el bloque `@font-face` suelto:
       * sin ellos, la cabecera institucional sale en Times New Roman y en negro puro mientras
       * el resto del informe usa la tipografía de la marca.
       */
      fontFaceCss: fonts.css,
      colors: input.brand.palette,
      type: {
        fontFamily: `${input.brand.typography.fontFamily}, ${fonts.fontFamily}`,
        monoFamily: `${input.brand.typography.monoFamily}, ${fonts.monoFamily}`,
        baseSizePt: input.brand.typography.baseSizePt,
      },
      margins: input.page.margins,
      data: input.data,
      document: {
        id: input.documentId,
        title: input.contract.title,
        templateId: input.contract.id,
        templateVersion: input.contract.version,
        createdAt: input.createdAt.toISOString(),
        createdAtLabel: formatDateTime(input.createdAt, input.locale, input.timezone),
        classification: input.classification,
        classificationLabel: input.classification
          ? CLASSIFICATION_LABELS[input.classification]
          : undefined,
      },
      brand: { id: input.brand.id, name: input.brand.name },
      letterhead: { ...input.letterhead, logoDataUri },
      footer: input.footer,
      page: { format: input.page.format, orientation: input.page.orientation },
      meta: {
        requestedBy: input.requestedBy,
        correlationId: input.correlationId,
        locale: input.locale,
        timezone: input.timezone,
      },
    };
  }
}
