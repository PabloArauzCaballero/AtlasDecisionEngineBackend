/**
 * Implementación del `PdfRendererPort` sobre Playwright + Chromium (§4).
 *
 * Es el ÚNICO archivo del worker que importa Playwright. Esa frase es comprobable —hay una
 * prueba que la verifica— y es lo que hace que el §48 no sea una intención: los casos de uso
 * no pueden depender de un navegador porque no lo ven.
 *
 * Dos garantías que se implementan aquí y no se ven en la firma del puerto:
 *
 *  - **Sin red.** Toda petición que salga de la página se ABORTA salvo `data:` y `about:`.
 *    No es un cinturón sobre tirantes: el HTML ya llega autocontenido, pero un template
 *    futuro con un `<img src="https://…">` copiado de un correo convertiría al worker en un
 *    cliente HTTP que visita lo que le digan, desde dentro de la red del motor (SSRF, §24).
 *  - **Sin JavaScript**, por defecto. Una plantilla no lo necesita, y sin él ningún payload
 *    puede ejecutar nada aunque atravesara el escapado.
 */
import { Injectable } from '@nestjs/common';
import type { Page } from 'playwright';
import type {
  PdfRendererPort,
  PdfRenderInput,
  PdfRenderResult,
  RendererHealth,
} from '../../../application/ports/pdf-renderer.port';
import {
  PdfRenderError,
  PdfRenderTimeoutError,
  PdfWorkerError,
} from '../../../domain/errors/pdf-worker.errors';
import { countPdfPages } from '../pdf-inspector';
import { BrowserPool, type BrowserPoolOptions } from './browser-pool';

/** Esquemas que la página puede resolver. Todo lo demás se corta. */
const ALLOWED_SCHEMES = ['data:', 'about:', 'blob:'];

@Injectable()
export class PlaywrightPdfRendererAdapter implements PdfRendererPort {
  readonly name = 'playwright-chromium';

  private readonly pool: BrowserPool;

  constructor(options: BrowserPoolOptions) {
    this.pool = new BrowserPool(options);
  }

  async render(input: PdfRenderInput): Promise<PdfRenderResult> {
    const startedAt = Date.now();
    try {
      return await this.renderOnce(input, startedAt);
    } catch (error) {
      throw asRenderError(error, input.timeoutMs, input.documentId);
    }
  }

  private async renderOnce(input: PdfRenderInput, startedAt: number): Promise<PdfRenderResult> {
    const content = await this.pool.withContext(async (context) => {
      const page = await context.newPage();
      try {
        await this.sealNetwork(page);
        page.setDefaultTimeout(input.timeoutMs);

        // `waitUntil: 'load'` y no `'networkidle'`: no hay red que pueda quedar ociosa, así
        // que `networkidle` sólo añadiría medio segundo de espera fija a cada documento.
        await page.setContent(input.html, { waitUntil: 'load', timeout: input.timeoutMs });
        // Sin esto se imprime la hoja de estilos de PANTALLA: los `@media print` del layout
        // —saltos de página, cabeceras de tabla repetidas, colores planos— no se aplicarían.
        await page.emulateMedia({ media: 'print' });

        return await page.pdf({
          format: input.page.format,
          landscape: input.page.orientation === 'landscape',
          printBackground: input.page.printBackground,
          scale: input.page.scale,
          margin: { ...input.page.margins },
          displayHeaderFooter: Boolean(input.headerHtml || input.footerHtml),
          // Chromium exige AMBAS plantillas cuando se activa la cabecera: si una va vacía,
          // dibuja su plantilla por defecto —la URL y la fecha del sistema— en mitad del
          // membrete institucional.
          headerTemplate: input.headerHtml ?? '<span></span>',
          footerTemplate: input.footerHtml ?? '<span></span>',
          // El plazo lo fija `setDefaultTimeout` unas líneas más arriba: `page.pdf()` no acepta
          // uno propio, y darle el suyo a `setContent` sin fijar el general dejaría la
          // impresión sin límite — que es justo el paso que puede colgarse.
          preferCSSPageSize: false,
        });
      } finally {
        await page.close().catch(() => undefined);
      }
    });

    return {
      content,
      durationMs: Date.now() - startedAt,
      renderer: this.name,
      pageCount: countPdfPages(content),
    };
  }

  async health(): Promise<RendererHealth> {
    const available = await this.pool.isReady();
    return {
      available,
      renderer: this.name,
      engineVersion: await this.pool.version(),
      activeRenders: this.pool.activeRenders,
      maxConcurrency: this.pool.maxConcurrency,
      detail: available ? undefined : 'el navegador no está disponible',
    };
  }

  async shutdown(): Promise<void> {
    await this.pool.shutdown();
  }

  /**
   * Corta la red de la página.
   *
   * Se aborta con `blockedbyclient`, que es lo que un bloqueador de contenido devolvería:
   * Chromium lo trata como un recurso denegado y sigue pintando el resto, en vez de dejar la
   * carga colgada hasta el plazo.
   */
  private async sealNetwork(page: Page): Promise<void> {
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (ALLOWED_SCHEMES.some((scheme) => url.startsWith(scheme))) {
        void route.continue();
        return;
      }
      void route.abort('blockedbyclient');
    });
  }
}

/**
 * Traduce el fallo del motor al vocabulario del dominio, sin filtrar rutas del anfitrión.
 *
 * Se deja pasar CUALQUIER `PdfWorkerError`, no sólo los dos de renderizado. Antes se
 * comprobaban únicamente `PdfRenderError` y `PdfRenderTimeoutError`, y el resultado era que el
 * rechazo por falta de carriles —que nace en el semáforo del pool, dentro de `render`— salía
 * envuelto como fallo del motor: el cliente recibía un 502 «el motor no produjo un PDF» donde
 * correspondía un 429 con su política de reintento. Lo detectó la prueba de concurrencia.
 */
export function asRenderError(error: unknown, timeoutMs: number, documentId: string): Error {
  if (error instanceof PdfWorkerError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|Timeout|exceeded/.test(message)) {
    return new PdfRenderTimeoutError(timeoutMs, { documentId });
  }
  return new PdfRenderError(message, { documentId }, error);
}
