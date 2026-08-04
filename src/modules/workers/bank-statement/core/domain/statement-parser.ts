import type { ExtractedPdf, ParsedStatement } from './models';

export interface StatementParser {
  readonly institutionCode: string;
  readonly formatId: string;
  supports(pdf: ExtractedPdf): boolean;
  parse(pdf: ExtractedPdf): ParsedStatement;
}
