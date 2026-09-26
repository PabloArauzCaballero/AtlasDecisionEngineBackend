/**
 * Persistencia del archivo generado (§39).
 *
 * El caso de uso no sabe si detrás hay un disco, S3, MinIO o R2. Guardar es OPCIONAL: el modo
 * síncrono devuelve el búfer sin escribir nada, y ésa es la ruta por defecto. Un generador
 * documental que obliga a persistir convierte cada «previsualiza esto» en basura que alguien
 * tendrá que barrer.
 */
import type { DocumentStorageRecord } from '../../domain/entities/generated-document';

export interface StoredDocumentMetadata {
  readonly documentId: string;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly checksum: string;
  readonly filename: string;
  readonly correlationId?: string;
}

export interface DocumentStoragePort {
  readonly provider: string;
  save(content: Buffer, metadata: StoredDocumentMetadata): Promise<DocumentStorageRecord>;
  /** Recuperación por clave. La usa la reposición idempotente y el descargable diferido. */
  load(key: string): Promise<Buffer | undefined>;
  /** Sonda de `/health`: un almacén inalcanzable no debe descubrirse al guardar el primer PDF. */
  health(): Promise<{ available: boolean; provider: string; detail?: string }>;
}

export const DOCUMENT_STORAGE_PORT = Symbol('DocumentStoragePort');
