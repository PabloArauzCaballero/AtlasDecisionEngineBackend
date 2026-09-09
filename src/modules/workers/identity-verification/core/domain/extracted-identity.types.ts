/**
 * Campos leídos de un documento de identidad. Absorbido sin cambios.
 *
 * Cada campo lleva su procedencia y su confianza porque un dato deducido
 * (`DERIVED`, como partir un nombre completo en nombres y apellidos) no vale lo
 * mismo que uno impreso y leído por OCR: fundirlos en un `string` haría
 * indistinguible «lo dice la cédula» de «lo supuso el analizador».
 */

/**
 * `MODEL` es la procedencia de un campo que PROPUSO un modelo multimodal
 * mirando la imagen, y no está a la altura de las demás a propósito: es la
 * única que no puede sostener por sí sola la afirmación «se leyó el documento».
 * `requiredFieldsPresent` la ignora, y por eso rellenar un campo con ella nunca
 * convierte una revisión en una aprobación. Ver `core/engine/second-reader.ts`.
 */
export type ExtractedFieldSource =
  'OCR' | 'BARCODE' | 'MRZ' | 'MANUAL' | 'PROVIDER' | 'DERIVED' | 'MODEL';

export interface ExtractedField<T> {
  value: T | null;
  confidence: number | null;
  source: ExtractedFieldSource;
  rawValue?: string;
  warnings?: string[];
}

export interface ExtractedIdentityData {
  documentType?: ExtractedField<string>;
  documentNumber?: ExtractedField<string>;
  firstNames?: ExtractedField<string>;
  lastNames?: ExtractedField<string>;
  fullName?: ExtractedField<string>;
  dateOfBirth?: ExtractedField<string>;
  nationality?: ExtractedField<string>;
  sex?: ExtractedField<string>;
  issueDate?: ExtractedField<string>;
  expirationDate?: ExtractedField<string>;
  placeOfBirth?: ExtractedField<string>;
  country?: ExtractedField<string>;
}
