/**
 * El documento producido y su ficha.
 *
 * `bytes` es opcional en la ficha que se publica: el modo síncrono devuelve el búfer, el
 * asíncrono devuelve sólo los metadatos y la clave de almacenamiento. Se modela como un solo
 * tipo con el búfer separado —no como dos— porque los dos modos comparten caso de uso (§17) y
 * duplicar la entidad es justo cómo se acaban desviando el uno del otro.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { DocumentClassification, GenerationStatus } from '../enums/document.enums';
import { PDF_MIME_TYPE } from '../enums/document.enums';
import type { TemplateRef } from '../value-objects/template-ref';

/** `DOC-` + 12 hexadecimales. Corto para caber en un pie, ancho para no colisionar. */
export function newDocumentId(): string {
  return `DOC-${randomBytes(6).toString('hex').toUpperCase()}`;
}

export const DOCUMENT_ID_PATTERN = /^DOC-[0-9A-F]{12}$/;

/**
 * Nombre de archivo seguro.
 *
 * Se aplica SIEMPRE, también al `filename` que llega en la petición: ese valor acaba en una
 * cabecera `Content-Disposition` y, si el almacenamiento está activado, en una ruta de disco.
 * Sin esto, `../../etc/passwd.pdf` es un nombre de archivo perfectamente aceptable.
 */
export function safeFilename(candidate: string, fallback: string): string {
  const base = candidate
    .normalize('NFKD')
    // Se quita la ruta ANTES de filtrar, para que `a/../b` no se convierta en `a..b`.
    .replace(/[\\/]/g, ' ')
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 120)
    .trim();
  const withoutExtension = base.replace(/\.pdf$/i, '');
  return `${withoutExtension || fallback}.pdf`;
}

export interface DocumentStorageRecord {
  readonly provider: string;
  readonly key: string;
  readonly url?: string;
}

export interface DocumentTrace {
  readonly correlationId?: string;
  readonly requestedBy?: string;
  readonly idempotencyKey?: string;
  readonly renderer: string;
  readonly renderDurationMs: number;
  readonly pageCount?: number;
}

export interface GeneratedDocument {
  readonly documentId: string;
  readonly template: { readonly id: string; readonly version: string };
  readonly filename: string;
  readonly mimeType: typeof PDF_MIME_TYPE;
  readonly sizeBytes: number;
  /** SHA-256 en hexadecimal del archivo exacto que se devuelve (§32). */
  readonly checksum: string;
  readonly createdAt: string;
  readonly status: GenerationStatus;
  readonly classification?: DocumentClassification;
  readonly brandId: string;
  readonly storage?: DocumentStorageRecord;
  readonly trace: DocumentTrace;
}

export function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export interface DocumentDraft {
  readonly documentId: string;
  readonly templateRef: TemplateRef;
  readonly filename: string;
  readonly createdAt: string;
  readonly classification?: DocumentClassification;
  readonly brandId: string;
  readonly status: GenerationStatus;
  readonly trace: DocumentTrace;
}

/** Construye la ficha a partir del archivo real: tamaño y checksum se MIDEN, no se declaran. */
export function describeDocument(draft: DocumentDraft, content: Uint8Array): GeneratedDocument {
  return {
    documentId: draft.documentId,
    template: { id: draft.templateRef.id, version: draft.templateRef.version },
    filename: draft.filename,
    mimeType: PDF_MIME_TYPE,
    sizeBytes: content.byteLength,
    checksum: sha256(content),
    createdAt: draft.createdAt,
    status: draft.status,
    classification: draft.classification,
    brandId: draft.brandId,
    trace: draft.trace,
  };
}

/** Firma de un PDF válido. Se comprueba antes de devolver nada: un HTML de error también son bytes. */
export const PDF_MAGIC = Buffer.from('%PDF-');

export function looksLikePdf(content: Uint8Array): boolean {
  return (
    content.byteLength > PDF_MAGIC.byteLength &&
    Buffer.from(content.subarray(0, 5)).equals(PDF_MAGIC)
  );
}
