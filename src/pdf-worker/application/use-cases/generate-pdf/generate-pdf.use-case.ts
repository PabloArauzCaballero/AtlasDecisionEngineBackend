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
  looksLikePdf,
  newDocumentId,
  safeFilename,
} from '../../../domain/entities/generated-document';
import { DOCUMENT_ID_PATTERN } from '../../../domain/entities/generated-document';
import {
  IdempotentRequestInFlightError,
  PdfRenderError,
  TemplatePayloadValidationError,
} from '../../../domain/errors/pdf-worker.errors';
import type { TemplateContract } from '../../../domain/contracts/template-contract';
import type { DocumentBrand } from '../../../domain/value-objects/document-brand';
import { TemplateRef } from '../../../domain/value-objects/template-ref';
import type { GeneratePdfCommand } from '../../dto/generate-pdf.command';
import type { GeneratePdfResult } from '../../dto/generate-pdf.result';
import { BRAND_REPOSITORY_PORT, type BrandRepositoryPort } from '../../ports/brand-repository.port';
import { DOCUMENT_STORAGE_PORT, type DocumentStoragePort } from '../../ports/document-storage.port';
import { EVENT_PUBLISHER_PORT, type EventPublisherPort } from '../../ports/event-publisher.port';
import {
  IDEMPOTENCY_STORE_PORT,
  type IdempotencyStorePort,
} from '../../ports/idempotency-store.port';
import { PDF_RENDERER_PORT, type PdfRendererPort } from '../../ports/pdf-renderer.port';
import { PDF_WORKER_SETTINGS, type PdfWorkerSettings } from '../../ports/settings.port';
import {
  CLOCK_PORT,
  LOGGER_PORT,
  PDF_METRICS_PORT,
  type ClockPort,
  type LoggerPort,
  type PdfMetricsPort,
} from '../../ports/runtime.ports';
import {
  TEMPLATE_REPOSITORY_PORT,
  type TemplateRepositoryPort,
} from '../../ports/template-repository.port';
import { DocumentComposer } from '../../services/document-composer';
import { buildComposeInput } from '../../services/compose-input';
import { buildIdempotencyKey } from '../../services/idempotency-key';
import { replayFrom } from './idempotent-replay';

@Injectable()
export class GeneratePdfUseCase {
  constructor(
    @Inject(TEMPLATE_REPOSITORY_PORT) private readonly templates: TemplateRepositoryPort,
    @Inject(BRAND_REPOSITORY_PORT) private readonly brands: BrandRepositoryPort,
    @Inject(PDF_RENDERER_PORT) private readonly renderer: PdfRendererPort,
    @Inject(DOCUMENT_STORAGE_PORT) private readonly storage: DocumentStoragePort,
    @Inject(IDEMPOTENCY_STORE_PORT) private readonly idempotency: IdempotencyStorePort,
    @Inject(EVENT_PUBLISHER_PORT) private readonly events: EventPublisherPort,
    @Inject(PDF_METRICS_PORT) private readonly metrics: PdfMetricsPort,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    @Inject(PDF_WORKER_SETTINGS) private readonly settings: PdfWorkerSettings,
    private readonly composer: DocumentComposer,
  ) {}

  async execute(command: GeneratePdfCommand): Promise<GeneratePdfResult> {
    const contract = this.templates.getTemplate(command.templateId, command.templateVersion);
    const templateRef = TemplateRef.of(contract.id, contract.version);
    const brand = command.brandId ? this.brands.get(command.brandId) : this.brands.getDefault();

    const parsed = contract.schema.parse(command.payload);
    if (!parsed.ok) {
      this.metrics.recordFailure(contract.id, 'TEMPLATE_PAYLOAD_INVALID');
      throw new TemplatePayloadValidationError(contract.id, contract.version, parsed.issues);
    }

    const requestedKey = command.metadata?.idempotencyKey;
    const scopedKey = requestedKey
      ? buildIdempotencyKey({
          idempotencyKey: requestedKey,
          templateId: contract.id,
          templateVersion: contract.version,
          brandId: brand.id,
          payload: command.payload,
        })
      : undefined;

    if (scopedKey && requestedKey) {
      const known = await this.idempotency.get(scopedKey);
      if (known) return replayFrom(known, templateRef, brand.id, this.storage, command);
      const acquired = await this.idempotency.acquire(
        scopedKey,
        this.settings.idempotencyLeaseSeconds,
      );
      if (!acquired) throw new IdempotentRequestInFlightError(requestedKey);
    }

    try {
      return await this.produce(command, contract, templateRef, brand, parsed.value, scopedKey);
    } catch (error) {
      await this.reportFailure(command, templateRef, error);
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
    const composeInput = buildComposeInput({
      contract,
      brand,
      data,
      documentId,
      createdAt,
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

    const shouldPersist =
      this.settings.storageEnabled && (command.options?.persist ?? this.settings.persistByDefault);
    const storage = shouldPersist
      ? await this.storage.save(rendered.content, {
          documentId,
          templateId: contract.id,
          templateVersion: contract.version,
          checksum: document.checksum,
          filename,
          correlationId: command.metadata?.correlationId,
        })
      : undefined;

    if (scopedKey) {
      await this.idempotency.put(
        scopedKey,
        {
          documentId,
          checksum: document.checksum,
          filename,
          sizeBytes: document.sizeBytes,
          createdAt: document.createdAt,
          storageKey: storage?.key,
          storageProvider: storage?.provider,
        },
        this.settings.idempotencyTtlSeconds,
      );
    }

    this.metrics.recordGenerated({
      templateId: contract.id,
      templateVersion: contract.version,
      renderer: rendered.renderer,
      durationMs: rendered.durationMs,
      sizeBytes: document.sizeBytes,
    });
    this.logger.info('Documento generado', {
      documentId,
      template: templateRef.toString(),
      brandId: brand.id,
      renderer: rendered.renderer,
      renderDurationMs: rendered.durationMs,
      sizeBytes: document.sizeBytes,
      pageCount: rendered.pageCount,
      correlationId: command.metadata?.correlationId,
      requestedBy: command.metadata?.requestedBy,
      persisted: Boolean(storage),
    });
    await this.events.publish({
      event: 'PDF_GENERATED',
      documentId,
      templateId: contract.id,
      templateVersion: contract.version,
      correlationId: command.metadata?.correlationId,
      requestedBy: command.metadata?.requestedBy,
      occurredAt: document.createdAt,
      checksum: document.checksum,
      sizeBytes: document.sizeBytes,
      renderDurationMs: rendered.durationMs,
      storage: storage ? { provider: storage.provider, key: storage.key } : undefined,
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

  private async reportFailure(
    command: GeneratePdfCommand,
    templateRef: TemplateRef,
    error: unknown,
  ): Promise<void> {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'PDF_RENDER_FAILED';
    this.metrics.recordFailure(templateRef.id, code);
    // El mensaje va, el payload NO (§33): puede contener datos personales y este registro se
    // conserva mucho más tiempo que la petición que lo produjo.
    this.logger.error('La generación falló', {
      template: templateRef.toString(),
      errorCode: code,
      reason: error instanceof Error ? error.message : String(error),
      correlationId: command.metadata?.correlationId,
    });
    await this.events.publish({
      event: 'PDF_GENERATION_FAILED',
      documentId: command.metadata?.documentId ?? 'unknown',
      templateId: templateRef.id,
      templateVersion: templateRef.version,
      correlationId: command.metadata?.correlationId,
      requestedBy: command.metadata?.requestedBy,
      occurredAt: this.clock.now().toISOString(),
      errorCode: code,
      reason: error instanceof Error ? error.message : 'error desconocido',
    });
  }
}
