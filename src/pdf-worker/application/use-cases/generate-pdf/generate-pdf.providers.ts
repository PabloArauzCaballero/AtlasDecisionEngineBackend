import { DocumentArchive } from './document-archive';
import { GeneratePdfUseCase } from './generate-pdf.use-case';
import { GenerationIdempotency } from './generation-idempotency';
import { GenerationReporter } from './generation-reporter';
import { PdfRenderingStage } from './pdf-rendering.stage';

/** El caso de uso de generación y los colaboradores que registra junto a él. */
export const GENERATE_PDF_PROVIDERS = [
  PdfRenderingStage,
  DocumentArchive,
  GenerationIdempotency,
  GenerationReporter,
  GeneratePdfUseCase,
];
