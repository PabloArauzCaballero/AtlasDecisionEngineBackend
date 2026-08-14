/**
 * Vocabulario cerrado del documento.
 *
 * Todo lo que aquí es una tupla `as const` acaba siendo a la vez tipo de TypeScript, enum de
 * Zod en los contratos y `enum` de OpenAPI en la documentación publicada. Declararlo una sola
 * vez evita el fallo clásico: añadir `A3` al validador y olvidarlo en el contrato, con lo que
 * el worker acepta un valor que el consumidor nunca supo que podía mandar.
 */

/** Formatos que Chromium sabe imprimir por nombre; cualquier otro exige medidas explícitas. */
export const PAGE_FORMATS = ['A3', 'A4', 'A5', 'Letter', 'Legal', 'Tabloid'] as const;
export type PageFormat = (typeof PAGE_FORMATS)[number];

export const PAGE_ORIENTATIONS = ['portrait', 'landscape'] as const;
export type PageOrientation = (typeof PAGE_ORIENTATIONS)[number];

/**
 * Clasificación institucional impresa en el pie.
 *
 * No controla acceso —el worker no es el guardián de nada—: es el rótulo que permite a quien
 * tiene el papel en la mano saber si puede dejarlo sobre una mesa.
 */
export const DOCUMENT_CLASSIFICATIONS = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'RESTRICTED',
] as const;
export type DocumentClassification = (typeof DOCUMENT_CLASSIFICATIONS)[number];

export const CLASSIFICATION_LABELS: Readonly<Record<DocumentClassification, string>> = {
  PUBLIC: 'Público',
  INTERNAL: 'Uso interno',
  CONFIDENTIAL: 'Confidencial',
  RESTRICTED: 'Restringido',
};

/** Desenlace de una solicitud de generación, común a los modos síncrono y asíncrono. */
export const GENERATION_STATUSES = ['GENERATED', 'REPLAYED', 'FAILED'] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

/**
 * `REPLAYED` es el resultado de una clave de idempotencia ya vista (§31): el documento que se
 * devuelve es EXACTAMENTE el de la primera vez, no uno nuevo con el mismo contenido. Quien
 * cuenta documentos emitidos necesita distinguirlos.
 */
export const GENERATION_STATUS_MEANING: Readonly<Record<GenerationStatus, string>> = {
  GENERATED: 'El documento se produjo en esta invocación.',
  REPLAYED: 'Se devolvió el documento de una invocación anterior con la misma idempotencyKey.',
  FAILED: 'La generación no llegó a producir un documento.',
};

/** Dónde se pinta el membrete completo. Ver `application/services/document-composer.ts`. */
export const LETTERHEAD_MODES = ['first-page', 'every-page', 'none'] as const;
export type LetterheadMode = (typeof LETTERHEAD_MODES)[number];

export const PDF_MIME_TYPE = 'application/pdf' as const;
