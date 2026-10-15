import { Inject, Injectable } from '@nestjs/common';
import type { GeneratedDocument } from '../../../domain/entities/generated-document';
import type { TemplateRef } from '../../../domain/value-objects/template-ref';
import type { GeneratePdfCommand } from '../../dto/generate-pdf.command';
import { EVENT_PUBLISHER_PORT, type EventPublisherPort } from '../../ports/event-publisher.port';
import {
  CLOCK_PORT,
  LOGGER_PORT,
  PDF_METRICS_PORT,
  type ClockPort,
  type LoggerPort,
  type PdfMetricsPort,
} from '../../ports/runtime.ports';
import type { DocumentStoragePort } from '../../ports/document-storage.port';

/** Lo que se cuenta de un documento recién generado. */
export interface GeneratedReport {
  document: GeneratedDocument;
  templateRef: TemplateRef;
  brandId: string;
  renderer: string;
  renderDurationMs: number;
  pageCount: number | undefined;
  storage: Awaited<ReturnType<DocumentStoragePort['save']>> | undefined;
  command: GeneratePdfCommand;
}

/**
 * Lo que la generación deja dicho fuera de sí: métricas, registro y eventos de
 * dominio. El evento va DESPUÉS de que el archivo exista.
 */
@Injectable()
export class GenerationReporter {
  constructor(
    @Inject(EVENT_PUBLISHER_PORT) private readonly events: EventPublisherPort,
    @Inject(PDF_METRICS_PORT) private readonly metrics: PdfMetricsPort,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
  ) {}

  payloadRejected(templateId: string): void {
    this.metrics.recordFailure(templateId, 'TEMPLATE_PAYLOAD_INVALID');
  }

  async generated(report: GeneratedReport): Promise<void> {
    const { document, templateRef, storage, command } = report;
    this.metrics.recordGenerated({
      templateId: templateRef.id,
      templateVersion: templateRef.version,
      renderer: report.renderer,
      durationMs: report.renderDurationMs,
      sizeBytes: document.sizeBytes,
    });
    this.logger.info('Documento generado', {
      documentId: document.documentId,
      template: templateRef.toString(),
      brandId: report.brandId,
      renderer: report.renderer,
      renderDurationMs: report.renderDurationMs,
      sizeBytes: document.sizeBytes,
      pageCount: report.pageCount,
      correlationId: command.metadata?.correlationId,
      requestedBy: command.metadata?.requestedBy,
      persisted: Boolean(storage),
    });
    await this.events.publish({
      event: 'PDF_GENERATED',
      documentId: document.documentId,
      templateId: templateRef.id,
      templateVersion: templateRef.version,
      correlationId: command.metadata?.correlationId,
      requestedBy: command.metadata?.requestedBy,
      occurredAt: document.createdAt,
      checksum: document.checksum,
      sizeBytes: document.sizeBytes,
      renderDurationMs: report.renderDurationMs,
      storage: storage ? { provider: storage.provider, key: storage.key } : undefined,
    });
  }

  async failed(
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
