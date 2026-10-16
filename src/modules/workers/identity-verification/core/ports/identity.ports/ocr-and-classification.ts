import type { IdentityDocumentType } from '../../domain/identity-enums';

export interface DocumentOcrInput {
  image: Buffer;
  correlationId: string;
}

export interface DocumentOcrLine {
  text: string;
  confidence: number | null;
}

export interface DocumentOcrResult {
  rawText: string;
  lines: DocumentOcrLine[];
  provider: string;
  modelVersion?: string;
}

export interface DocumentOcrPort {
  extract(input: DocumentOcrInput): Promise<DocumentOcrResult>;
  health(): Promise<{ ready: boolean; detail?: string }>;
}

// --- Clasificación del documento -------------------------------------------

export interface DocumentClassificationInput {
  /** Las dos caras unidas. Es lo que ve un clasificador que no distingue caras. */
  rawText: string;
  documentCountry: string;
  /**
   * El texto de CADA cara, cuando quien llama las tiene por separado.
   *
   * El catálogo de la cédula sitúa cada anclaje en su cara —`SERIE` va delante,
   * la MRZ detrás— y medirlo sobre las dos juntas convierte la plantilla en una
   * bolsa de palabras: un anclaje de reverso encontrado en el anverso deja de
   * significar lo que el catálogo dice. Opcionales porque una captura de sólo
   * anverso es legítima y frecuente, y porque un clasificador que no los use
   * sigue siendo un clasificador válido.
   */
  frontText?: string;
  backText?: string;
}

export interface DocumentClassificationResult {
  type: IdentityDocumentType;
  confidence: number;
  signals: string[];
}

export interface DocumentClassifierPort {
  classify(input: DocumentClassificationInput): Promise<DocumentClassificationResult>;
}

// --- Arbitraje de la duda ---------------------------------------------------
