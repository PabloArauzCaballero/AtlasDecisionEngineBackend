import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { StatementProcessingError } from '../../domain/errors';
import type { ExtractedPdf, PageLine } from '../../domain/models';
import { LayoutPdfReader } from '../../pdf/layout-pdf-reader';
import type { ExtractionMethod } from '../statement-context';
import { STATEMENT_OCR_PORT, type OcrLine, type StatementOcrPort } from './ocr-port';

/**
 * Una página se considera **imagen** cuando no aporta ni un carácter de texto.
 *
 * El criterio es cero, y no un mínimo de densidad, a propósito: cualquier umbral
 * por encima de cero convierte en «escaneada» una página legítima que solo lleve
 * un pie o una nota corta, y mandarla a OCR sería gastar segundos en reconocer
 * algo que ya se podía leer. Si pdf.js no encontró **nada**, no hay capa de
 * texto que aprovechar y el reconocimiento óptico es la única vía.
 */
const EMPTY_PAGE_CHARACTERS = 0;

export interface ExtractionOutcome {
  readonly pdf: ExtractedPdf;
  readonly method: ExtractionMethod;
  /** Páginas que hubo que reconocer ópticamente. */
  readonly ocrPages: readonly number[];
  readonly warnings: readonly string[];
}

/**
 * Obtiene el texto del documento por el camino más barato que sirva.
 *
 * Prioriza siempre la capa de texto del PDF y **solo** pide OCR para las
 * páginas que no la tienen. Esa selectividad es la diferencia entre un
 * documento que se procesa en milisegundos y uno que tarda segundos por página:
 * ejecutar OCR completo «por si acaso» multiplicaría el coste de cada
 * conversión para beneficiar a una minoría de documentos.
 */
@Injectable()
export class StatementExtractor {
  private readonly logger = new Logger(StatementExtractor.name);

  constructor(
    private readonly reader: LayoutPdfReader,
    @Optional()
    @Inject(STATEMENT_OCR_PORT)
    private readonly ocr?: StatementOcrPort,
  ) {}

  async extract(buffer: Buffer): Promise<ExtractionOutcome> {
    const pdf = await this.reader.extract(buffer);
    // Un PDF válido sin ninguna página es un archivo, no un documento. Se separa
    // del escaneado —que sí tiene páginas, sólo que en imagen— porque el
    // desenlace es distinto: aquí no hay nada que una persona pueda revisar.
    if (pdf.pageCount === 0) {
      throw new StatementProcessingError(
        'EMPTY_DOCUMENT',
        'El PDF no contiene ninguna página.',
        422,
      );
    }
    const imagePages = pagesWithoutText(pdf);

    if (imagePages.length === 0) {
      return { pdf, method: 'TEXT', ocrPages: [], warnings: [] };
    }

    if (!this.ocr) {
      // Ninguna página tiene texto: no hay nada que analizar y decirlo es más
      // útil que devolver un extracto vacío.
      if (imagePages.length === pdf.pageCount) {
        throw new StatementProcessingError(
          'SCANNED_PDF_UNSUPPORTED',
          'El PDF no contiene texto: parece escaneado y no hay reconocimiento óptico configurado.',
          422,
          { pageCount: pdf.pageCount },
        );
      }
      return {
        pdf,
        method: 'TEXT',
        ocrPages: [],
        warnings: [`paginas-sin-texto-omitidas:${imagePages.length}`],
      };
    }

    const result = await this.ocr.recognize({
      pdf: buffer,
      pages: imagePages.map((pageNumber) => ({
        pageNumber,
        pageWidth: pageWidthOf(pdf, pageNumber),
      })),
    });
    this.logger.log(
      `Reconocimiento óptico aplicado: motor=${result.engine} ` + `paginas=${imagePages.join(',')}`,
    );

    const merged = mergeOcrLines(pdf, result.lines);
    return {
      pdf: merged,
      // `OCR` cuando todo el documento vino de la imagen; `HYBRID` cuando solo
      // parte de él. La diferencia importa al interpretar la confianza.
      method: imagePages.length === pdf.pageCount ? 'OCR' : 'HYBRID',
      ocrPages: imagePages,
      warnings: [`paginas-reconocidas-por-ocr:${imagePages.length}`],
    };
  }
}

/** Números de página sin capa de texto aprovechable. */
export function pagesWithoutText(pdf: ExtractedPdf): number[] {
  const charactersByPage = new Map<number, number>();
  for (let page = 1; page <= pdf.pageCount; page += 1) {
    charactersByPage.set(page, 0);
  }
  for (const line of pdf.lines) {
    charactersByPage.set(
      line.page,
      (charactersByPage.get(line.page) ?? 0) + line.text.trim().length,
    );
  }
  return [...charactersByPage.entries()]
    .filter(([, characters]) => characters <= EMPTY_PAGE_CHARACTERS)
    .map(([page]) => page)
    .sort((a, b) => a - b);
}

/**
 * Inserta las líneas reconocidas en el documento, en el orden de lectura que
 * espera el resto del motor: por página y, dentro de cada una, de arriba abajo.
 */
export function mergeOcrLines(pdf: ExtractedPdf, ocrLines: readonly OcrLine[]): ExtractedPdf {
  const recognized: PageLine[] = ocrLines.map((line) => ({
    page: line.page,
    pageWidth: line.pageWidth,
    y: line.y,
    tokens: [...line.tokens],
    text: line.tokens
      .map((token) => token.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  }));

  const lines = [...pdf.lines, ...recognized].sort((a, b) => a.page - b.page || b.y - a.y);
  return {
    pageCount: pdf.pageCount,
    lines,
    text: lines.map((line) => line.text).join('\n'),
  };
}

function pageWidthOf(pdf: ExtractedPdf, pageNumber: number): number {
  return pdf.lines.find((line) => line.page === pageNumber)?.pageWidth ?? 612;
}
