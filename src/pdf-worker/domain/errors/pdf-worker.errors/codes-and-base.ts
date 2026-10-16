/** Códigos publicados. Se comparan por igualdad en clientes y paneles; no se renombran. */
export const PDF_ERROR_CODES = [
  'TEMPLATE_NOT_FOUND',
  'TEMPLATE_VERSION_NOT_FOUND',
  'TEMPLATE_ALREADY_REGISTERED',
  'TEMPLATE_PAYLOAD_INVALID',
  'TEMPLATE_SOURCE_INVALID',
  'TEMPLATE_RENDER_FAILED',
  'PDF_RENDER_FAILED',
  'PDF_RENDER_TIMEOUT',
  'PDF_RENDER_CAPACITY_EXCEEDED',
  'ASSET_RESOLUTION_FAILED',
  'DOCUMENT_STORAGE_FAILED',
  'INVALID_BRAND',
  'PROTECTED_OPTION_OVERRIDE',
  'IDEMPOTENT_REQUEST_IN_FLIGHT',
  // --- Administración de templates (CRUD) ---
  'TEMPLATE_BUNDLE_INVALID',
  'TEMPLATE_IMMUTABLE',
  'TEMPLATE_STORE_FAILED',
  'TEMPLATE_ADMIN_DISABLED',
  'TEMPLATE_ADMIN_UNAUTHORIZED',
  'TEMPLATE_BUILTIN_PROTECTED',
  'ARTIFACT_CONTRACT_UNAVAILABLE',
  'ARTIFACT_NOT_FOUND',
  // --- Acceso al servicio, sólo cuando corre como proceso suelto ---
  'SERVICE_UNAUTHORIZED',
] as const;

export type PdfErrorCode = (typeof PDF_ERROR_CODES)[number];

export abstract class PdfWorkerError extends Error {
  abstract readonly code: PdfErrorCode;

  /** Sugerencia de estado HTTP. La traducción real vive en la capa de presentación. */
  abstract readonly httpStatus: number;

  protected constructor(
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
    options?: { cause?: unknown },
  ) {
    super(message, options as ErrorOptions);
    this.name = new.target.name;
    // `Error` no restaura el prototipo al transpilar a ES5/ES2022 con `extends`; sin esto,
    // `instanceof PdfWorkerError` puede fallar según el `target`, y el filtro de excepciones
    // caería al caso genérico convirtiendo un 400 explicativo en un 500 mudo.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
