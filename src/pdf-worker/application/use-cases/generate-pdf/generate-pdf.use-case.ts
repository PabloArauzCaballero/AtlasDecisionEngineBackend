/**
 * El caso de uso central: datos entran, documento sale.
 *
 * Es el MISMO objeto que atiende `POST /pdf/generate` y el consumidor de la cola (§17). No hay
 * una versión «rápida» para HTTP y otra para el trabajo de fondo; si la hubiera, una de las
 * dos acabaría validando distinto, y el documento saldría diferente según por dónde entrase.
 *
 * El orden de los pasos no es casual:
 *
 *   1. resolver template y marca      — barato, y falla con un 404 explicativo
 *   2. validar el payload             — antes de levantar nada; es el 90 % de los rechazos
 *   3. idempotencia                   — antes de renderizar, que es lo caro
 *   4. componer HTML                  — sin red, sin recursos externos
 *   5. imprimir                       — el único paso con un navegador detrás
 *   6. comprobar que son bytes de PDF — un HTML de error también «pesa»
 *   7. guardar (opcional) y publicar  — el evento va DESPUÉS de que el archivo exista
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  describeDocument,
  DOCUMENT_ID_PATTERN,
  newDocumentId,
  safeFilename,
} from '../../../domain/entities/generated-document';
import { TemplatePayloadValidationError } from '../../../domain/errors/pdf-worker.errors';
import type { TemplateContract } from '../../../domain/contracts/template-contract';
import type { DocumentBrand } from '../../../domain/value-objects/document-brand';
import { TemplateRef } from '../../../domain/value-objects/template-ref';
import type { GeneratePdfCommand } from '../../dto/generate-pdf.command';
import type { GeneratePdfResult } from '../../dto/generate-pdf.result';
import { BRAND_REPOSITORY_PORT, type BrandRepositoryPort } from '../../ports/brand-repository.port';
import { CLOCK_PORT, type ClockPort } from '../../ports/runtime.ports';
import {
  TEMPLATE_REPOSITORY_PORT,
  type TemplateRepositoryPort,
} from '../../ports/template-repository.port';
import { DocumentArchive } from './document-archive';
import { GenerationIdempotency } from './generation-idempotency';
import { GenerationReporter } from './generation-reporter';
import { PdfRenderingStage } from './pdf-rendering.stage';

@Injectable()
export class GeneratePdfUseCase {
  constructor(
    @Inject(TEMPLATE_REPOSITORY_PORT) private readonly templates: TemplateRepositoryPort,
    @Inject(BRAND_REPOSITORY_PORT) private readonly brands: BrandRepositoryPort,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    private readonly rendering: PdfRenderingStage,
    private readonly archive: DocumentArchive,
    private readonly idempotency: GenerationIdempotency,
    private readonly reporter: GenerationReporter,
  ) {}

  async execute(command: GeneratePdfCommand): Promise<GeneratePdfResult> {
    const contract = this.templates.getTemplate(command.templateId, command.templateVersion);
    const templateRef = TemplateRef.of(contract.id, contract.version);
    const brand = command.brandId ? this.brands.get(command.brandId) : this.brands.getDefault();

    const parsed = contract.schema.parse(command.payload);
    if (!parsed.ok) {
      this.reporter.payloadRejected(contract.id);
      throw new TemplatePayloadValidationError(contract.id, contract.version, parsed.issues);
    }

    const admission = await this.idempotency.admit(command, contract, templateRef, brand);
    if (admission.kind === 'replay') return admission.result;
    const { scopedKey } = admission;

    try {
      return await this.produce(command, contract, templateRef, brand, parsed.value, scopedKey);
    } catch (error) {
      await this.reporter.failed(command, templateRef, error);
      throw error;
    } finally {
      if (scopedKey) await this.idempotency.release(scopedKey);
    }
  }

  private async produce(
    command: GeneratePdfCommand,
    contract: TemplateContract,
    templateRef: TemplateRef,
    brand: DocumentBrand,
    data: unknown,
    scopedKey: string | undefined,
  ): Promise<GeneratePdfResult> {
    const createdAt = this.clock.now();
    const documentId = this.resolveDocumentId(command.metadata?.documentId);
    const { rendered, classification } = await this.rendering.render({
      command,
      contract,
      brand,
      data,
      documentId,
      createdAt,
    });

    const filename = safeFilename(
      command.options?.filename ?? `${contract.id}-${documentId}`,
      contract.id,
    );
    const document = describeDocument(
      {
        documentId,
        templateRef,
        filename,
        createdAt: createdAt.toISOString(),
        classification,
        brandId: brand.id,
        status: 'GENERATED',
        trace: {
          correlationId: command.metadata?.correlationId,
          requestedBy: command.metadata?.requestedBy,
          idempotencyKey: command.metadata?.idempotencyKey,
          renderer: rendered.renderer,
          renderDurationMs: rendered.durationMs,
          pageCount: rendered.pageCount,
        },
      },
      rendered.content,
    );

    const storage = await this.archive.saveIfRequested(command, rendered.content, {
      documentId,
      templateId: contract.id,
      templateVersion: contract.version,
      checksum: document.checksum,
      filename,
      correlationId: command.metadata?.correlationId,
    });

    if (scopedKey) await this.idempotency.remember(scopedKey, { ...document, storage });

    await this.reporter.generated({
      document,
      templateRef,
      brandId: brand.id,
      renderer: rendered.renderer,
      renderDurationMs: rendered.durationMs,
      pageCount: rendered.pageCount,
      storage,
      command,
    });

    return {
      ...document,
      storage,
      content: command.options?.returnContent === false ? undefined : rendered.content,
    };
  }

  /** Acepta un identificador impuesto sólo si tiene la forma canónica; si no, emite uno. */
  private resolveDocumentId(supplied: string | undefined): string {
    return supplied && DOCUMENT_ID_PATTERN.test(supplied) ? supplied : newDocumentId();
  }
}
