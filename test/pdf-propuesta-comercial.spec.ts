import { GeneratePdfUseCase } from '../src/pdf-worker/application/use-cases/generate-pdf/generate-pdf.use-case';
import { TemplatePayloadValidationError } from '../src/pdf-worker/domain/errors/pdf-worker.errors';
import { propuestaComercialFixture } from '../src/pdf-worker/templates/documents/propuesta-comercial/1.0.0/preview.fixture';
import { createPdfWorkerHarness, type Harness } from './support/pdf-worker-harness';

/**
 * La propuesta la recibe un COMERCIO. Antes salía por `generic-result-report`: «Informe de
 * resultado · Uso interno» y «Este apartado no aporta datos» bajo cada párrafo.
 */
describe('propuesta-comercial@1.0.0', () => {
  let harness: Harness;
  let generate: GeneratePdfUseCase;

  beforeAll(async () => {
    harness = await createPdfWorkerHarness();
    generate = harness.module.get(GeneratePdfUseCase);
  });

  afterAll(async () => {
    await harness.close();
  });

  async function componer(payload: unknown) {
    await generate.execute({
      templateId: 'propuesta-comercial',
      brandId: 'atlas-comercial',
      payload,
    } as never);
    return harness.renderer.lastCall;
  }

  it('se lee como carta a un cliente: portada, nota, condiciones, pasos y firma; nada de «uso interno»', async () => {
    const { html } = await componer(propuestaComercialFixture());
    for (const texto of [
      'Comercio de Ejemplo',
      'Como conversamos el martes',
      'Condiciones económicas',
      'Así funciona, paso a paso',
      'Próximos pasos',
      'Ejecutiva comercial · ATLAS',
    ]) {
      expect(html).toContain(texto);
    }
    expect(html).not.toMatch(/Uso interno|Informe de resultado|no aporta datos/i);
  });

  it('explica en dibujos lo que se promete: riesgo cero, cobro directo y sin catálogo', async () => {
    const { html: bruto } = await componer(propuestaComercialFixture());
    // El HTML se reformatea al componerse: se compara con los blancos normalizados.
    const html = bruto.replace(/\s+/g, ' ');
    // Portada, riesgo, QR, simplicidad, ventas y cuatro pasos: nueve ilustraciones por la plantilla, más iconos.
    expect((html.match(/<svg[^>]*class=["'][^"']*art /g) ?? []).length).toBeGreaterThanOrEqual(9);
    for (const texto of [
      'Venda más hoy.',
      'Cobre sin riesgo.',
      'Riesgo cero',
      'Pago directo',
      'Sin catálogo',
      'Tres promesas, sin letra chica',
      'Ningún dinero pasa por las cuentas de ATLAS',
    ]) {
      expect(html).toContain(texto);
    }
    // Sin recursos externos: el PDF se compone sin red.
    expect(html).not.toMatch(/(href|src)=['"]https?:/i);
  });

  it('es una carta de cuatro páginas a sangre completa: márgenes 0 y sin pie corrido', async () => {
    const llamada = await componer(propuestaComercialFixture());
    expect(llamada.page.margins).toEqual({ top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' });
    expect((llamada.html.match(/class=["']pg pg--/g) ?? []).length).toBe(4);
  });

  it('no deja la cabecera vacía: Chromium pintaría la suya (fecha y título)', async () => {
    const llamada = await componer(propuestaComercialFixture());
    expect(llamada.headerHtml).toBe('');
    // Carta a sangre completa (márgenes 0): un pie corrido se pintaría encima del cuerpo.
    expect(llamada.footerHtml).toBe('');
  });

  it('escapa la nota del comercial y el nombre del comercio', async () => {
    const payload = propuestaComercialFixture();
    payload.nota = { autor: 'Ana', texto: '<img src=x onerror=alert(1)>' };
    payload.comercio.nombre = '<b>Comercio</b>';
    const { html } = await componer(payload);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src');
    expect(html).not.toContain('<b>Comercio</b>');
  });

  it('rechaza campos que no están en el contrato antes de imprimir', async () => {
    const antes = harness.renderer.calls.length;
    await expect(
      generate.execute({
        templateId: 'propuesta-comercial',
        payload: { ...propuestaComercialFixture(), extra: 1 },
      } as never),
    ).rejects.toBeInstanceOf(TemplatePayloadValidationError);
    expect(harness.renderer.calls.length).toBe(antes);
  });
});
