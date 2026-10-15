import { Inject, Injectable } from '@nestjs/common';
import type { TemplateContract } from '../../../domain/contracts/template-contract';
import { IdempotentRequestInFlightError } from '../../../domain/errors/pdf-worker.errors';
import type { DocumentBrand } from '../../../domain/value-objects/document-brand';
import type { TemplateRef } from '../../../domain/value-objects/template-ref';
import type { GeneratePdfCommand } from '../../dto/generate-pdf.command';
import type { GeneratePdfResult } from '../../dto/generate-pdf.result';
import { DOCUMENT_STORAGE_PORT, type DocumentStoragePort } from '../../ports/document-storage.port';
import {
  IDEMPOTENCY_STORE_PORT,
  type IdempotencyStorePort,
} from '../../ports/idempotency-store.port';
import { PDF_WORKER_SETTINGS, type PdfWorkerSettings } from '../../ports/settings.port';
import { buildIdempotencyKey } from '../../services/idempotency-key';
import { replayFrom } from './idempotent-replay';

/** Resultado de pedir paso: o hay que reponer un documento, o hay que generar (con la llave tomada). */
export type IdempotencyDecision =
  | { kind: 'replay'; result: GeneratePdfResult }
  | { kind: 'proceed'; scopedKey: string | undefined };

/** El documento ya emitido que una repetición debe recibir en lugar de uno nuevo. */
export interface EmittedDocument {
  documentId: string;
  checksum: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
  storage?: { key: string; provider: string } | undefined;
}

/**
 * Idempotencia de la generación: la misma petición, con la misma llave y el mismo contenido,
 * devuelve el documento de la primera vez. Se resuelve ANTES de renderizar, que es lo caro.
 */
@Injectable()
export class GenerationIdempotency {
  constructor(
    @Inject(IDEMPOTENCY_STORE_PORT) private readonly store: IdempotencyStorePort,
    @Inject(DOCUMENT_STORAGE_PORT) private readonly storage: DocumentStoragePort,
    @Inject(PDF_WORKER_SETTINGS) private readonly settings: PdfWorkerSettings,
  ) {}

  async admit(
    command: GeneratePdfCommand,
    contract: TemplateContract,
    templateRef: TemplateRef,
    brand: DocumentBrand,
  ): Promise<IdempotencyDecision> {
    const requestedKey = command.metadata?.idempotencyKey;
    if (!requestedKey) return { kind: 'proceed', scopedKey: undefined };
    const scopedKey = buildIdempotencyKey({
      idempotencyKey: requestedKey,
      templateId: contract.id,
      templateVersion: contract.version,
      brandId: brand.id,
      payload: command.payload,
    });
    const known = await this.store.get(scopedKey);
    if (known) {
      return {
        kind: 'replay',
        result: await replayFrom(known, templateRef, brand.id, this.storage, command),
      };
    }
    const acquired = await this.store.acquire(scopedKey, this.settings.idempotencyLeaseSeconds);
    if (!acquired) throw new IdempotentRequestInFlightError(requestedKey);
    return { kind: 'proceed', scopedKey };
  }

  async remember(scopedKey: string, emitted: EmittedDocument): Promise<void> {
    await this.store.put(
      scopedKey,
      {
        documentId: emitted.documentId,
        checksum: emitted.checksum,
        filename: emitted.filename,
        sizeBytes: emitted.sizeBytes,
        createdAt: emitted.createdAt,
        storageKey: emitted.storage?.key,
        storageProvider: emitted.storage?.provider,
      },
      this.settings.idempotencyTtlSeconds,
    );
  }

  async release(scopedKey: string): Promise<void> {
    await this.store.release(scopedKey);
  }
}
