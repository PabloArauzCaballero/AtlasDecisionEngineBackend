/**
 * Catálogo cerrado de fallos del generador documental.
 *
 * El dominio NO conoce HTTP: `httpStatus` es un número, no el enum `HttpStatus` de Nest.
 * Esa distinción no es cosmética — es lo que permite que estos errores viajen por la cola
 * asíncrona, por el SDK en proceso y por el controlador REST sin que ninguno de los tres
 * arrastre a los otros dos. Quien habla HTTP los traduce en `presentation/http`.
 *
 * Cada error lleva `code` estable (el que se publica al consumidor y el que etiqueta la
 * métrica) y `details` estructurado. `throw new Error('error')` está prohibido aquí: un
 * fallo sin código no se puede contar, ni alertar, ni explicar a quien mandó el payload.
 */
export {
  ArtifactContractUnavailableError,
  ArtifactNotFoundError,
  TemplateBuiltinProtectedError,
} from './artifact-errors';
export { PDF_ERROR_CODES, PdfWorkerError } from './codes-and-base';
export type { PdfErrorCode } from './codes-and-base';
export {
  AssetResolutionError,
  DocumentStorageError,
  PdfRenderError,
  PdfRenderTimeoutError,
  RenderCapacityExceededError,
} from './render-errors';
export {
  IdempotentRequestInFlightError,
  InvalidBrandError,
  ProtectedOptionOverrideError,
  ServiceUnauthorizedError,
  TemplateAdminDisabledError,
  TemplateAdminUnauthorizedError,
  TemplateBundleInvalidError,
  TemplateImmutableError,
  TemplateStoreError,
} from './request-errors';
export {
  TemplateAlreadyRegisteredError,
  TemplateNotFoundError,
  TemplatePayloadValidationError,
  TemplateRenderError,
  TemplateSourceError,
  TemplateVersionNotFoundError,
} from './template-errors';
export type { PayloadIssue } from './template-errors';
