import {
  sanitizeCorrelationId,
  type StatementProcessingContext,
} from '../domain/processing-context';
import type { DocumentClassifier } from '../engine/document-classifier';
import type { ExtractionOutcome } from '../engine/extraction/statement-extractor';
import type { InstitutionDetector } from '../engine/institution-detector';
import { fileDigest, type StatementContext } from '../engine/statement-context';

/** Quienes leen el documento ya extraído para saber qué es y de quién es. */
export interface DocumentReaders {
  classifier: DocumentClassifier;
  institutionDetector: InstitutionDetector;
}

/**
 * Construye el contexto que comparten todas las etapas. Se hace una sola vez
 * por documento: la extracción y la clasificación son las dos operaciones más
 * caras del proceso, y ninguna estrategia debe repetirlas.
 */
export function buildStatementContext(
  readers: DocumentReaders,
  buffer: Buffer,
  processing: StatementProcessingContext,
  extraction: ExtractionOutcome,
): StatementContext {
  const pdf = extraction.pdf;
  return {
    pdf,
    source: {
      fileName: processing.fileName,
      fileHash: fileDigest(buffer),
      byteLength: buffer.byteLength,
      pageCount: pdf.pageCount,
      extractionMethod: extraction.method,
    },
    classification: readers.classifier.classify(pdf),
    // La asignación de quien revisó manda sobre la detección; un código desconocido se ignora.
    institution:
      (processing.assignedInstitutionCode &&
        readers.institutionDetector.assigned(processing.assignedInstitutionCode, pdf)) ||
      readers.institutionDetector.detect(pdf),
    correlationId: sanitizeCorrelationId(processing.correlationId),
  };
}
