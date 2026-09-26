/**
 * Almacenamiento en disco local (§39).
 *
 * Es la implementación inicial, no la definitiva: existe para que el puerto esté ejercitado por
 * algo real desde el primer día. Cambiar a S3, MinIO, R2, GCS o Azure Blob es escribir otra
 * clase con estos cuatro métodos; ningún caso de uso se entera.
 *
 * La clave se reparte por fecha (`2026/02/11/DOC-….pdf`). Un directorio plano con cien mil
 * archivos hace que cada `readdir` —y cada copia de seguridad— tarde en proporción al total, y
 * eso no se nota hasta que ya hay cien mil.
 */
import { Injectable } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type {
  DocumentStoragePort,
  StoredDocumentMetadata,
} from '../../application/ports/document-storage.port';
import type { DocumentStorageRecord } from '../../domain/entities/generated-document';
import { DocumentStorageError } from '../../domain/errors/pdf-worker.errors';

@Injectable()
export class LocalDocumentStorageAdapter implements DocumentStoragePort {
  readonly provider = 'local';

  constructor(private readonly root: string) {}

  async save(content: Buffer, metadata: StoredDocumentMetadata): Promise<DocumentStorageRecord> {
    const key = buildKey(metadata);
    const path = this.pathOf(key);
    try {
      await mkdir(dirname(path), { recursive: true });
      // `wx` falla si el archivo ya existe. Es lo correcto: dos documentos no pueden compartir
      // `documentId`, así que una colisión significa que algo va mal —un identificador
      // impuesto y repetido, por ejemplo— y sobrescribir destruiría el primero en silencio.
      await writeFile(path, content, { flag: 'wx' });
    } catch (error) {
      throw new DocumentStorageError(
        this.provider,
        error instanceof Error ? error.message : String(error),
        error,
      );
    }
    return { provider: this.provider, key };
  }

  async load(key: string): Promise<Buffer | undefined> {
    try {
      return await readFile(this.pathOf(key));
    } catch {
      // Que un documento ya no esté no es un fallo del almacén: puede haberlo purgado la
      // retención. Quien llama decide qué hacer con la ausencia.
      return undefined;
    }
  }

  async health(): Promise<{ available: boolean; provider: string; detail?: string }> {
    try {
      await mkdir(resolve(this.root), { recursive: true });
      return { available: true, provider: this.provider };
    } catch (error) {
      return {
        available: false,
        provider: this.provider,
        detail: error instanceof Error ? error.message : 'directorio inaccesible',
      };
    }
  }

  /** Ninguna clave puede salir del directorio raíz, venga de donde venga. */
  private pathOf(key: string): string {
    const path = resolve(join(this.root, key));
    const rel = relative(resolve(this.root), path);
    if (rel.startsWith('..') || rel.startsWith(`..${sep}`)) {
      throw new DocumentStorageError(this.provider, `la clave «${key}» sale del directorio raíz.`);
    }
    return path;
  }
}

/** `2026/02/11/DOC-A1B2C3D4E5F6.pdf`. El nombre ya viene saneado por `safeFilename`. */
export function buildKey(metadata: StoredDocumentMetadata, now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}/${month}/${day}/${metadata.documentId}.pdf`;
}
