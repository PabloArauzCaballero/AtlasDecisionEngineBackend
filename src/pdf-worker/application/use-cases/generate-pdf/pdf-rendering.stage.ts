import { Inject, Injectable } from '@nestjs/common';
import { looksLikePdf } from '../../../domain/entities/generated-document';
import { PdfRenderError } from '../../../domain/errors/pdf-worker.errors';
import type { TemplateContract } from '../../../domain/contracts/template-contract';
import type { DocumentBrand } from '../../../domain/value-objects/document-brand';
import type { GeneratePdfCommand } from '../../dto/generate-pdf.command';
import { PDF_RENDERER_PORT, type PdfRendererPort } from '../../ports/pdf-renderer.port';
import { PDF_WORKER_SETTINGS, type PdfWorkerSettings } from '../../ports/settings.port';
import { buildComposeInput } from '../../services/compose-input';
import { DocumentComposer } from '../../services/document-composer';

/** Lo que pide imprimir un documento. */
export interface RenderRequest {
  command: GeneratePdfCommand;
  contract: TemplateContract;
  brand: DocumentBrand;
  data: unknown;
  documentId: string;
  createdAt: Date;
}

/**
 * Componer el HTML e imprimirlo, y comprobar que lo impreso es un PDF dentro del tamaño
 * permitido. Es el único tramo con un navegador detrás.
 */
@Injectable()
export class PdfRenderingStage {
  constructor(
    @Inject(PDF_RENDERER_PORT) private readonly renderer: PdfRendererPort,
    @Inject(PDF_WORKER_SETTINGS) private readonly settings: PdfWorkerSettings,
    private readonly composer: DocumentComposer,
  ) {}

  async render(request: RenderRequest) {
    const { command, documentId } = request;
    const composeInput = buildComposeInput({
      contract: request.contract,
      brand: request.brand,
      data: request.data,
      documentId,
      createdAt: request.createdAt,
      metadata: command.metadata,
      options: command.options,
      settings: this.settings,
    });
    const { page, classification } = composeInput;

    const composed = await this.composer.compose(composeInput);

    const rendered = await this.renderer.render({
      html: composed.html,
      page,
      headerHtml: composed.headerHtml,
      footerHtml: composed.footerHtml,
      timeoutMs: this.settings.renderTimeoutMs,
      documentId,
    });

    // Un motor puede devolver bytes sin producir un PDF —una página de error, un HTML de
    // diagnóstico— y esos bytes tienen tamaño y checksum como cualquier otro archivo. Sin esta
    // comprobación, el fallo llega hasta el navegador de quien abre el «documento».
    if (!looksLikePdf(rendered.content)) {
      throw new PdfRenderError('la salida no empieza por la firma %PDF-', {
        documentId,
        sizeBytes: rendered.content.byteLength,
      });
    }
    if (rendered.content.byteLength > this.settings.maxDocumentBytes) {
      throw new PdfRenderError('el documento supera el tamaño máximo configurado', {
        documentId,
        sizeBytes: rendered.content.byteLength,
        maxDocumentBytes: this.settings.maxDocumentBytes,
      });
    }
    return { rendered, classification };
  }
}
