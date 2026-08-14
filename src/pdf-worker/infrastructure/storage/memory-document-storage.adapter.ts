/**
 * Almacén en memoria, para pruebas y para el modo sin persistencia.
 *
 * No es un «doble de mentira»: implementa el mismo puerto y se comporta igual —incluida la
 * negativa a sobrescribir una clave existente—, así que una prueba que pasa contra éste
 * ejercita el mismo camino del caso de uso que la versión de disco.
 *
 * Tiene un tope de entradas por la razón obvia: sin él, una batería larga guarda cada PDF que
 * genera y el proceso de pruebas crece hasta morir.
 */
import { Injectable } from '@nestjs/common';
import type {
  DocumentStoragePort,
  StoredDocumentMetadata,
} from '../../application/ports/document-storage.port';
import type { DocumentStorageRecord } from '../../domain/entities/generated-document';
import { DocumentStorageError } from '../../domain/errors/pdf-worker.errors';
import { buildKey } from './local-document-storage.adapter';

@Injectable()
export class MemoryDocumentStorageAdapter implements DocumentStoragePort {
  readonly provider = 'memory';

  private readonly documents = new Map<string, Buffer>();

  constructor(private readonly maxEntries = 200) {}

  async save(content: Buffer, metadata: StoredDocumentMetadata): Promise<DocumentStorageRecord> {
    const key = buildKey(metadata);
    if (this.documents.has(key)) {
      throw new DocumentStorageError(this.provider, `la clave «${key}» ya existe.`);
    }
    if (this.documents.size >= this.maxEntries) {
      // Se descarta la más antigua: `Map` conserva el orden de inserción, así que la primera
      // clave es siempre la que lleva más tiempo dentro.
      const oldest = this.documents.keys().next();
      if (!oldest.done) this.documents.delete(oldest.value);
    }
    this.documents.set(key, Buffer.from(content));
    return { provider: this.provider, key };
  }

  async load(key: string): Promise<Buffer | undefined> {
    return this.documents.get(key);
  }

  async health(): Promise<{ available: boolean; provider: string; detail?: string }> {
    return {
      available: true,
      provider: this.provider,
      detail: `${this.documents.size}/${this.maxEntries} documentos en memoria`,
    };
  }
}
