import { Inject, Injectable } from '@nestjs/common';
import type { ExtractedPdf, PageLine, TextToken } from '../domain/models';
import { StatementProcessingError } from '../domain/errors';
import { BANK_STATEMENT_OPTIONS, type BankStatementModuleOptions } from '../options';
import { importEsm } from './esm-import';
import { TimeoutExceededError, withTimeout } from './timeout';

/**
 * Lo único que este lector usa de `pdfjs-dist`. Se declara a mano porque el
 * módulo se carga con `importEsm`, que devuelve `unknown` a propósito: traer
 * los tipos reales obligaría a resolver un paquete ESM desde código CommonJS
 * sólo para tipar una llamada.
 */
interface PdfjsModuleLike {
  getDocument(params: { data: Uint8Array; useSystemFonts: boolean }): PdfLoadingTaskLike;
}

/**
 * La tarea de carga: lo que se libera al terminar.
 *
 * Se declara aquí, con lo MÍNIMO que este lector usa, por la misma razón que el resto de las
 * formas de este archivo: pdfjs-dist no publica tipos que se puedan importar desde CommonJS sin
 * arrastrar el paquete entero, y una forma escrita a mano deja explícito qué parte de esa API
 * sostiene el motor de extractos. Cuando pdfjs quitó `PDFDocumentProxy.destroy()` en la v6, la
 * forma escrita a mano fue justamente lo que dejó el cambio a la vista en un solo sitio.
 */
interface PdfLoadingTaskLike {
  promise: Promise<PdfDocumentLike>;
  destroy(): Promise<void> | void;
}

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
}

interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}

interface PdfViewportLike {
  width: number;
  height: number;
  /** Matriz que lleva del espacio del PDF al de la página ya rotada. */
  transform: number[];
}

interface PdfPageLike {
  getViewport(params: { scale: number }): PdfViewportLike;
  getTextContent(): Promise<{ items: unknown[] }>;
  cleanup(): void;
}

/**
 * Aplica una matriz afín de PDF —`[a, b, c, d, e, f]`— a un punto.
 *
 * Es lo que hace utilizable una **página rotada**: pdf.js entrega las
 * coordenadas de cada ficha en el espacio del documento, sin rotar, mientras
 * que las columnas del extracto están donde el lector las ve. Sin esta
 * conversión, un extracto con `/Rotate 90` produce columnas cruzadas y ningún
 * analizador reconoce nada.
 */
export function applyTransform(
  point: readonly [number, number],
  matrix: readonly number[],
): [number, number] {
  const [x, y] = point;
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = matrix;
  return [a * x + c * y + e, b * x + d * y + f];
}

/**
 * Mensaje de un fallo que puede no ser un `Error` de ESTE realm.
 *
 * `instanceof Error` es falso para lo que cruza una frontera de contexto: la
 * máquina virtual de Jest, un worker thread, el cargador ESM. `pdfjs` se carga
 * precisamente con un `import()` dinámico, así que sus errores llegan por ahí y
 * la comprobación fallaba, dejando `reason: 'Error desconocido'`.
 *
 * Eso no es un detalle cosmético: el motivo real —«falta --experimental-vm-modules»,
 * «PDF cifrado», «memoria agotada»— es lo único que distingue un documento malo
 * de un entorno mal montado, y sin él `PDF_EXTRACTION_FAILED` culpa siempre al
 * documento. Se lee el `message` por forma, no por linaje.
 */
function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && message.trim()) {
    const name = (error as { name?: unknown }).name;
    return typeof name === 'string' && name.trim() ? `${name}: ${message}` : message;
  }
  return 'Error desconocido';
}

function toPdfTextItem(value: unknown): PdfTextItem | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as {
    str?: unknown;
    transform?: unknown;
    width?: unknown;
  };
  if (
    typeof candidate.str !== 'string' ||
    !Array.isArray(candidate.transform) ||
    !candidate.transform.every((item) => typeof item === 'number') ||
    typeof candidate.width !== 'number'
  ) {
    return undefined;
  }
  return {
    str: candidate.str,
    transform: candidate.transform,
    width: candidate.width,
  };
}

@Injectable()
export class LayoutPdfReader {
  constructor(
    @Inject(BANK_STATEMENT_OPTIONS)
    private readonly options: BankStatementModuleOptions,
  ) {}

  async extract(buffer: Buffer): Promise<ExtractedPdf> {
    /*
     * Se libera la TAREA DE CARGA, no el documento.
     *
     * `PDFDocumentProxy.destroy()` desapareció en pdfjs-dist 6 (era un alias en desuse de la v5)
     * y el `finally` de abajo empezó a lanzar `TypeError: document.destroy is not a function`
     * DESDE EL BLOQUE DE LIMPIEZA — que es el peor sitio donde puede fallar algo, porque
     * sustituye el resultado, y también el error real si lo hubo, por un fallo de la limpieza.
     * Cinco pruebas de extractos pasaron a decir «no se pudo leer la estructura del PDF» sobre
     * PDF que se habían leído enteros y bien.
     *
     * La tarea es además el asidero correcto: destruirla cierra el worker de pdfjs, mientras que
     * el documento sólo soltaba su parte.
     */
    const loadingTask = this.startLoad(buffer);
    const loadPromise = loadingTask.promise;
    let document: PdfDocumentLike | undefined;
    try {
      const work = (async (): Promise<ExtractedPdf> => {
        document = await loadPromise;
        if (document.numPages > this.options.maxPageCount) {
          throw new StatementProcessingError(
            'PDF_TOO_COMPLEX',
            `El PDF supera el límite de ${this.options.maxPageCount} páginas admitidas.`,
            422,
            {
              pageCount: document.numPages,
              maxPageCount: this.options.maxPageCount,
            },
          );
        }
        return this.readAllPages(document);
      })();
      return await withTimeout(work, this.options.processingTimeoutMs);
    } catch (error) {
      if (error instanceof StatementProcessingError) throw error;
      if (error instanceof TimeoutExceededError) {
        throw new StatementProcessingError(
          'PDF_PROCESSING_TIMEOUT',
          'El PDF tardó demasiado en procesarse y fue descartado.',
          422,
        );
      }
      const message = errorMessage(error);
      if (/password|encrypted/i.test(message)) {
        throw new StatementProcessingError(
          'ENCRYPTED_PDF',
          'No se admiten PDF protegidos con contraseña.',
          422,
        );
      }
      throw new StatementProcessingError(
        'PDF_EXTRACTION_FAILED',
        'No fue posible leer la estructura del PDF.',
        422,
        { reason: message },
      );
    } finally {
      /*
       * Una sola vía de liberación, pase lo que pase.
       *
       * Antes había dos ramas —una para el documento ya resuelto y otra para la carga que aún
       * podía terminar después de rendirse por reloj—, y las dos llamaban a un método que ya no
       * existe. Destruir la tarea cubre los dos casos: si la carga sigue en vuelo, `destroy()`
       * la aborta; si terminó, cierra el documento y su worker.
       *
       * `catch` vacío y `void` porque esto es limpieza: un fallo aquí no puede tapar ni el
       * resultado ni el error de verdad. Ésa fue exactamente la avería que se está corrigiendo.
       */
      void Promise.resolve(loadingTask.destroy()).catch(() => undefined);
      // `document` se sigue leyendo arriba; esta referencia deja constancia de que su ciclo de
      // vida lo gobierna ahora la tarea, no él mismo.
      document = undefined;
    }
  }

  /**
   * Arranca la carga y devuelve la TAREA, no la promesa del documento.
   *
   * Devolver la tarea es lo que permite liberarla en el `finally` aunque la carga todavía no
   * haya terminado. Con sólo la promesa, rendirse por reloj dejaba el worker de pdfjs residente
   * hasta que la carga acabara sola.
   */
  private startLoad(buffer: Buffer): PdfLoadingTaskLike {
    // `importEsm` y no `await import(...)`: este archivo se compila a CommonJS
    // y `pdf.mjs` es ESM puro. Ver `./esm-import.ts`.
    const modulo = importEsm<PdfjsModuleLike>('pdfjs-dist/legacy/build/pdf.mjs');
    let destruir: (() => void) | undefined;
    const promise = modulo.then((pdfjs) => {
      const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
      destruir = () => void Promise.resolve(task.destroy()).catch(() => undefined);
      return task.promise;
    });
    return {
      promise,
      // Si aún no se ha resuelto el módulo no hay nada que destruir todavía; se encadena para
      // que la destrucción ocurra en cuanto exista la tarea.
      destroy: () => {
        void modulo.then(() => destruir?.()).catch(() => undefined);
      },
    };
  }

  private async readAllPages(document: PdfDocumentLike): Promise<ExtractedPdf> {
    const pageCount = document.numPages;
    const lines: PageLine[] = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const tokens: TextToken[] = [];
      for (const item of textContent.items) {
        const safeItem = toPdfTextItem(item);
        if (!safeItem || safeItem.str.trim().length === 0) continue;
        const origin: [number, number] = [safeItem.transform[4] ?? 0, safeItem.transform[5] ?? 0];
        const [x, y] = applyTransform(origin, viewport.transform);
        const [endX, endY] = applyTransform(
          [origin[0] + safeItem.width, origin[1]],
          viewport.transform,
        );
        tokens.push({
          text: safeItem.str.trim(),
          x,
          // Se invierte el eje para conservar la convención del módulo —mayor
          // `y`, más arriba en la página—, que es la que usan el agrupado de
          // líneas y todos los analizadores.
          y: viewport.height - y,
          // Distancia entre inicio y fin ya rotados: el ancho visible de la
          // ficha, cualquiera que sea la orientación de la página.
          width: Math.hypot(endX - x, endY - y),
        });
      }
      lines.push(...this.groupIntoLines(tokens, pageNumber, viewport.width));
      page.cleanup();
    }

    return {
      pageCount,
      lines,
      text: lines.map((line) => line.text).join('\n'),
    };
  }

  private groupIntoLines(tokens: TextToken[], page: number, pageWidth: number): PageLine[] {
    const grouped: Array<{ y: number; tokens: TextToken[] }> = [];
    const sorted = [...tokens].sort((a, b) => b.y - a.y || a.x - b.x);

    for (const token of sorted) {
      const line = grouped.find((candidate) => Math.abs(candidate.y - token.y) <= 2);
      if (line) {
        line.tokens.push(token);
      } else {
        grouped.push({ y: token.y, tokens: [token] });
      }
    }

    return grouped
      .sort((a, b) => b.y - a.y)
      .map((line) => {
        const ordered = line.tokens.sort((a, b) => a.x - b.x);
        return {
          page,
          pageWidth,
          y: line.y,
          tokens: ordered,
          text: ordered
            .map((token) => token.text)
            .join(' ')
            .replace(/\s+/g, ' '),
        };
      });
  }
}
