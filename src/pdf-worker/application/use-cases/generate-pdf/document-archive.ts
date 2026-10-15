import { Inject, Injectable } from '@nestjs/common';
import type { GeneratePdfCommand } from '../../dto/generate-pdf.command';
import { DOCUMENT_STORAGE_PORT, type DocumentStoragePort } from '../../ports/document-storage.port';
import { PDF_WORKER_SETTINGS, type PdfWorkerSettings } from '../../ports/settings.port';

/** Guarda el documento cuando la petición (o la configuración por omisión) lo pide. */
@Injectable()
export class DocumentArchive {
  constructor(
    @Inject(DOCUMENT_STORAGE_PORT) private readonly storage: DocumentStoragePort,
    @Inject(PDF_WORKER_SETTINGS) private readonly settings: PdfWorkerSettings,
  ) {}

  async saveIfRequested(
    command: GeneratePdfCommand,
    content: Buffer,
    meta: Parameters<DocumentStoragePort['save']>[1],
  ) {
    const shouldPersist =
      this.settings.storageEnabled && (command.options?.persist ?? this.settings.persistByDefault);
    return shouldPersist ? this.storage.save(content, meta) : undefined;
  }
}
