/**
 * Vocabulario cerrado del worker de verificación de identidad.
 *
 * Absorbido del paquete original (`domain/enums/`) sin cambiar un valor: estos
 * literales viajan al resultado publicado y a los códigos de motivo, así que
 * renombrarlos rompería a cualquiera que ya los lea.
 */

export enum IdentityDocumentType {
  BOLIVIA_CI = 'BOLIVIA_CI',
  PASSPORT = 'PASSPORT',
  DRIVER_LICENSE = 'DRIVER_LICENSE',
  UNKNOWN = 'UNKNOWN',
}

export enum IdentityDecision {
  VERIFIED = 'VERIFIED',
  REVIEW_REQUIRED = 'REVIEW_REQUIRED',
  NOT_VERIFIED = 'NOT_VERIFIED',
  INCONCLUSIVE = 'INCONCLUSIVE',
}
