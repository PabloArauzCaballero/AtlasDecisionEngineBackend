export type StatementErrorCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_PDF'
  | 'ENCRYPTED_PDF'
  | 'SCANNED_PDF_UNSUPPORTED'
  | 'NOT_A_FINANCIAL_STATEMENT'
  | 'UNSUPPORTED_INSTITUTION'
  | 'UNSUPPORTED_STATEMENT_FORMAT'
  | 'NO_TRANSACTIONS'
  | 'PDF_EXTRACTION_FAILED'
  | 'PDF_TOO_COMPLEX'
  | 'PDF_PROCESSING_TIMEOUT'
  | 'INTERNAL_ERROR';

export class StatementProcessingError extends Error {
  constructor(
    readonly code: StatementErrorCode,
    message: string,
    readonly httpStatus: number,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'StatementProcessingError';
  }
}
