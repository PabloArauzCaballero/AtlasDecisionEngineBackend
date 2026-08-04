import { createHash } from 'node:crypto';
import type { ExtractedPdf, PageLine } from '../domain/models';

/**
 * Cómo se obtuvo el texto del documento.
 *
 * `TEXT` es lo que produce el lector por coordenadas de este módulo. Los otros
 * tres existen porque el contrato de salida los declara y porque un anfitrión
 * puede inyectar un extractor propio; el módulo no empaqueta ninguno.
 */
export type ExtractionMethod = 'TEXT' | 'TABLE' | 'OCR' | 'HYBRID';

/** Código de entidad cuando ninguna señal permite atribuir el documento. */
export const UNKNOWN_INSTITUTION_CODE = 'UNKNOWN_FINANCIAL_INSTITUTION';

export interface StatementSource {
  /**
   * Nombre original del archivo, si el anfitrión lo aportó. Nunca se usa para
   * decidir nada del análisis: lo controla quien sube el archivo.
   */
  readonly fileName?: string;
  /** SHA-256 del PDF. Identifica el documento en las trazas sin exponerlo. */
  readonly fileHash: string;
  readonly byteLength: number;
  readonly pageCount: number;
  readonly extractionMethod: ExtractionMethod;
}

export interface DocumentClassification {
  readonly documentType: string;
  readonly isFinancialStatement: boolean;
  readonly confidence: number;
  readonly detectedSignals: readonly string[];
}

export interface InstitutionDetection {
  /** Código del registro, o `UNKNOWN_FINANCIAL_INSTITUTION`. */
  readonly code: string;
  readonly name?: string;
  readonly detected: boolean;
  readonly confidence: number;
  readonly signals: readonly string[];
}

/**
 * Todo lo que una estrategia necesita para decidir si puede analizar un
 * documento y para analizarlo.
 *
 * Es inmutable y lo construyen las etapas del proceso en orden: primero la
 * extracción, después la clasificación y por último la detección de entidad.
 * Que sea un objeto y no una lista de argumentos es lo que permite añadir una
 * señal nueva sin cambiar la firma de ninguna estrategia.
 */
export interface StatementContext {
  readonly pdf: ExtractedPdf;
  readonly source: StatementSource;
  readonly classification: DocumentClassification;
  readonly institution: InstitutionDetection;
  readonly correlationId?: string;
}

export function fileDigest(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Formas de fecha con las que un extracto abre una fila de movimiento, en
 * cualquiera de las plantillas medidas.
 */
const ROW_DATE =
  /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|^\d{4}[/-]\d{1,2}[/-]\d{1,2}\b|^\d{1,2}\/[A-Za-zÁÉÍÓÚáéíóú]{3}\/\d{4}\b/;

/** Tope de renglones de carátula, por si un documento no tuviera tabla. */
const MAX_COVER_LINES = 40;

/**
 * Separación vertical mínima que aísla el pie de página del cuerpo del
 * documento.
 *
 * El pie **no** se puede tomar como «las últimas N líneas»: medido sobre el
 * extracto real de BancoSol, la tabla termina a 332 pt del pie, y quedarse con
 * las seis últimas líneas arrastraba la glosa `Banco:Bec - Banco Económico` de
 * una transferencia recibida. Con ella, el documento se atribuía al Banco
 * Económico. Lo que distingue al pie es el hueco que lo separa, no su posición.
 */
const FOOTER_MIN_GAP = 40;

/**
 * Carátula y pie de la primera página: la región donde un extracto se
 * identifica a sí mismo.
 *
 * **La región termina en la primera fila de movimiento**, y esa frontera es la
 * que evita un error de atribución medido sobre un extracto real: el de Banco
 * Mercantil menciona «BANCO GANADERO S.A.» en decenas de glosas de
 * transferencia, de modo que buscar marcadores de entidad en todo el documento
 * —o en un número fijo de líneas— se lo atribuiría a la entidad equivocada.
 *
 * El pie se incluye porque hay formatos, como el de BancoSol, que imprimen su
 * dominio y su teléfono solo ahí.
 */
export function coverRegion(pdf: ExtractedPdf): PageLine[] {
  const firstPage = pdf.lines.filter((line) => line.page === 1);
  const firstRow = firstPage.findIndex((line) => ROW_DATE.test(line.text.trim()));
  const coverEnd = firstRow >= 0 ? firstRow : firstPage.length;
  const cover = firstPage.slice(0, Math.min(coverEnd, MAX_COVER_LINES));
  const seen = new Set(cover);
  return [...cover, ...footerRegion(firstPage).filter((line) => !seen.has(line))];
}

/**
 * Renglones separados del cuerpo por un hueco vertical claro al final de la
 * página. Vacío si no hay tal hueco: es preferible perder el pie a confundir
 * con él la última fila de la tabla.
 */
function footerRegion(firstPage: readonly PageLine[]): PageLine[] {
  for (let index = firstPage.length - 1; index > 0; index -= 1) {
    const previous = firstPage[index - 1];
    const current = firstPage[index];
    if (!previous || !current) continue;
    if (previous.y - current.y > FOOTER_MIN_GAP) {
      return [...firstPage.slice(index)];
    }
  }
  return [];
}

export function coverText(pdf: ExtractedPdf): string {
  return coverRegion(pdf)
    .map((line) => line.text)
    .join('\n');
}
