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
      'Una nota de Ana Pérez',
      'Condiciones económicas',
      'Cómo funciona',
      'Próximos pasos',
      'Ejecutiva comercial · ATLAS',
    ]) {
      expect(html).toContain(texto);
    }
    expect(html).not.toMatch(/Uso interno|Informe de resultado|no aporta datos/i);
  });

  it('no deja la cabecera vacía: Chromium pintaría la suya (fecha y título)', async () => {
    const llamada = await componer(propuestaComercialFixture());
    expect(llamada.headerHtml).toBe('');
    expect(llamada.footerHtml).toContain('Compras en cuotas para su comercio');
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
