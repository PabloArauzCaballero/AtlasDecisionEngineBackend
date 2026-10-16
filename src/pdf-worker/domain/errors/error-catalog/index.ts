import { PDF_ERROR_CODES, type PdfErrorCode } from '../pdf-worker.errors';
import { ARTIFACT_ERRORS } from './artifact';
import { REQUEST_AND_ADMIN_ERRORS } from './request-and-admin';
import { TEMPLATE_AND_RENDER_ERRORS } from './lookup-and-render';
import type { ErrorCatalogEntry } from './types';

export type { ErrorAudience, ErrorCatalogEntry } from './types';

export const PDF_ERROR_CATALOG: Readonly<Record<PdfErrorCode, ErrorCatalogEntry>> = {
  ...TEMPLATE_AND_RENDER_ERRORS,
  ...REQUEST_AND_ADMIN_ERRORS,
  ...ARTIFACT_ERRORS,
};

/** Lista ordenada, para publicarla y para documentarla. */
export function errorCatalogEntries(): readonly ErrorCatalogEntry[] {
  return PDF_ERROR_CODES.map((code) => PDF_ERROR_CATALOG[code]);
}
