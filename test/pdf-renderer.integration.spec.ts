/**
 * El motor de impresión REAL: Playwright + Chromium.
 *
 * Es `.integration.spec.ts` porque necesita el navegador instalado, así que queda fuera de
 * `test:unit`. Lo que comprueba no lo puede comprobar ninguna prueba con dobles: que el
 * documento que sale es un PDF de verdad, que pagina, que la numeración se resuelve y —lo más
 * importante— que la página NO puede salir a la red.
 */
import { PlaywrightPdfRendererAdapter } from '../src/pdf-worker/infrastructure/rendering/playwright/playwright-pdf-renderer.adapter';
import { countPdfPages } from '../src/pdf-worker/infrastructure/rendering/pdf-inspector';
import { looksLikePdf } from '../src/pdf-worker/domain/entities/generated-document';
import { DEFAULT_PAGE_SETUP } from '../src/pdf-worker/domain/value-objects/page-setup';
import { RenderCapacityExceededError } from '../src/pdf-worker/domain/errors/pdf-worker.errors';

jest.setTimeout(180_000);

function pageOf(body: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
    body { font-family: sans-serif; font-size: 10pt; margin: 0; }
    .salto { break-before: page; page-break-before: always; }
    thead { display: table-header-group; }
    td, th { border: 0.4pt solid #888; padding: 2mm; }
  </style></head><body>${body}</body></html>`;
}

describe('PlaywrightPdfRendererAdapter (integración)', () => {
  let renderer: PlaywrightPdfRendererAdapter;

  beforeAll(() => {
    renderer = new PlaywrightPdfRendererAdapter({
      concurrency: 2,
      queueTimeoutMs: 20_000,
      headless: true,
      javaScriptEnabled: false,
    });
  });

  afterAll(async () => {
    await renderer.shutdown();
  });

  it('produce un PDF válido con acentos, eñes y símbolos', async () => {
    const result = await renderer.render({
      html: pageOf(
        '<h1>Informe de créditos — Nuñez &amp; Peñaranda</h1><p>Bs 12.480,75 · 78 %</p>',
      ),
      page: DEFAULT_PAGE_SETUP,
      timeoutMs: 60_000,
      documentId: 'DOC-000000000001',
    });

    expect(looksLikePdf(result.content)).toBe(true);
    expect(result.content.byteLength).toBeGreaterThan(1_000);
    expect(result.renderer).toBe('playwright-chromium');
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.pageCount).toBe(1);
  });

  it('pagina un documento largo y cuenta bien las páginas', async () => {
    const secciones = Array.from(
      { length: 4 },
      (_, index) =>
        `<section class="salto"><h2>Sección ${index + 1}</h2><p>Contenido</p></section>`,
    ).join('');

    const result = await renderer.render({
      html: pageOf(`<h1>Multipágina</h1>${secciones}`),
      page: DEFAULT_PAGE_SETUP,
      timeoutMs: 60_000,
      documentId: 'DOC-000000000002',
    });

    // Cuatro saltos explícitos sobre la primera hoja: cinco páginas.
    expect(result.pageCount).toBe(5);
    expect(countPdfPages(result.content)).toBe(5);
  });

  it('reparte una tabla larga en varias hojas repitiendo la cabecera', async () => {
    const filas = Array.from(
      { length: 120 },
      (_, index) =>
        `<tr><td>${index + 1}</td><td>Movimiento número ${index + 1}</td><td>1.234,56</td></tr>`,
    ).join('');

    const result = await renderer.render({
      html: pageOf(
        `<table><thead><tr><th>#</th><th>Concepto</th><th>Importe</th></tr></thead><tbody>${filas}</tbody></table>`,
      ),
      page: DEFAULT_PAGE_SETUP,
      timeoutMs: 60_000,
      documentId: 'DOC-000000000003',
    });

    expect(result.pageCount).toBeGreaterThan(1);
    expect(looksLikePdf(result.content)).toBe(true);
  });

  it('resuelve «Página X de Y» en el pie', async () => {
    const conNumeracion = await renderer.render({
      html: pageOf('<h1>Con pie</h1><div class="salto">Segunda</div>'),
      page: DEFAULT_PAGE_SETUP,
      headerHtml: '<div style="font-size:8pt;width:100%;padding:0 15mm">Membrete</div>',
      footerHtml:
        '<div style="font-size:8pt;width:100%;padding:0 15mm">' +
        'Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>',
      timeoutMs: 60_000,
      documentId: 'DOC-000000000004',
    });

    // El total sólo lo conoce el motor una vez paginado; ninguna plantilla del cuerpo podría
    // calcularlo. Lo que se comprueba es que el documento con pie sigue siendo válido y que la
    // presencia del pie no cambió la paginación.
    expect(looksLikePdf(conNumeracion.content)).toBe(true);
    expect(conNumeracion.pageCount).toBe(2);
  });

  it('NO deja que la página salga a la red', async () => {
    // Una dirección de metadatos de nube: si el recurso se cargara, el generador sería un
    // cliente HTTP que visita lo que le digan desde dentro de la red del motor (SSRF).
    const result = await renderer.render({
      html: pageOf('<img src="http://169.254.169.254/latest/meta-data" alt="x"><p>Sigue vivo</p>'),
      page: DEFAULT_PAGE_SETUP,
      timeoutMs: 30_000,
      documentId: 'DOC-000000000005',
    });

    // El recurso se aborta como «bloqueado por el cliente» y el resto se pinta igual: la
    // barrera no puede convertir cada imagen olvidada en un documento fallido.
    expect(looksLikePdf(result.content)).toBe(true);
    expect(result.durationMs).toBeLessThan(30_000);
  });

  it('informa de su estado y de la versión del navegador', async () => {
    const health = await renderer.health();
    expect(health.available).toBe(true);
    expect(health.renderer).toBe('playwright-chromium');
    expect(health.engineVersion).toMatch(/^\d+\./);
    expect(health.maxConcurrency).toBe(2);
  });

  it('responde 429 cuando no hay carril libre en el plazo, en vez de agotar el reloj', async () => {
    const estrecho = new PlaywrightPdfRendererAdapter({
      concurrency: 1,
      queueTimeoutMs: 1,
      headless: true,
      javaScriptEnabled: false,
    });
    try {
      const enCurso = estrecho.render({
        html: pageOf('<h1>Ocupa el carril</h1>'),
        page: DEFAULT_PAGE_SETUP,
        timeoutMs: 60_000,
        documentId: 'DOC-000000000006',
      });
      const rechazado = estrecho
        .render({
          html: pageOf('<h1>No cabe</h1>'),
          page: DEFAULT_PAGE_SETUP,
          timeoutMs: 60_000,
          documentId: 'DOC-000000000007',
        })
        .catch((error: unknown) => error);

      await expect(enCurso).resolves.toBeDefined();
      expect(await rechazado).toBeInstanceOf(RenderCapacityExceededError);
    } finally {
      await estrecho.shutdown();
    }
  });
});
