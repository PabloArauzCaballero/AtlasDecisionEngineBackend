/**
 * El caso de uso completo, con las plantillas reales y sin navegador.
 *
 * Cubre buena parte del §47: template inexistente, versión inexistente, payload válido e
 * inválido, campo obligatorio ausente, enum inválido, fallo del motor, idempotencia, tabla
 * larga, multipágina y caracteres UTF-8 con acentos y eñes.
 */
import { GeneratePdfUseCase } from '../src/pdf-worker/application/use-cases/generate-pdf/generate-pdf.use-case';
import { PreviewTemplateUseCase } from '../src/pdf-worker/application/use-cases/preview-template/preview-template.use-case';
import { GetTemplateDefinitionUseCase } from '../src/pdf-worker/application/use-cases/get-template-definition/get-template-definition.use-case';
import {
  PdfRenderError,
  TemplateNotFoundError,
  TemplatePayloadValidationError,
  TemplateVersionNotFoundError,
} from '../src/pdf-worker/domain/errors/pdf-worker.errors';
import { genericResultReportFixture } from '../src/pdf-worker/templates/documents/generic-result-report/1.0.0/preview.fixture';
import { createPdfWorkerHarness, FROZEN_AT, type Harness } from './support/pdf-worker-harness';

describe('GeneratePdfUseCase', () => {
  let harness: Harness;
  let generate: GeneratePdfUseCase;

  beforeAll(async () => {
    harness = await createPdfWorkerHarness();
    generate = harness.module.get(GeneratePdfUseCase);
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('camino feliz', () => {
    it('genera un documento y mide tamaño, checksum y páginas del archivo real', async () => {
      const result = await generate.execute({
        templateId: 'generic-result-report',
        payload: genericResultReportFixture(),
        metadata: { correlationId: 'corr-1', requestedBy: 'motor@atlas' },
        options: { persist: true },
      });

      expect(result.status).toBe('GENERATED');
      expect(result.template).toEqual({ id: 'generic-result-report', version: '1.0.0' });
      expect(result.mimeType).toBe('application/pdf');
      expect(result.documentId).toMatch(/^DOC-[0-9A-F]{12}$/);
      expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(result.sizeBytes).toBe(result.content?.byteLength);
      expect(result.createdAt).toBe(FROZEN_AT.toISOString());
      expect(result.trace.pageCount).toBe(3);
      expect(result.storage?.provider).toBe('memory');
    });

    it('resuelve la última versión cuando la petición no la fija, y la ARCHIVA', async () => {
      const result = await generate.execute({
        templateId: 'credit-analysis-report',
        payload: {
          customerName: 'Juan Pérez Añez',
          score: 700,
          decision: 'APPROVED',
        },
      });
      // Si el resultado devolviera sólo el `templateId`, el archivo no podría reconstruirse.
      expect(result.template.version).toBe('1.1.0');
    });
  });

  describe('el HTML que llega al motor de impresión', () => {
    it('lleva membrete, pie con numeración y ninguna referencia remota', async () => {
      await generate.execute({
        templateId: 'generic-result-report',
        payload: genericResultReportFixture(),
      });
      const { html, headerHtml, footerHtml } = harness.renderer.lastCall;

      expect(headerHtml).toContain('Cooperativa Nuñez &amp; Peñaranda');
      // Los ganchos que rellena el motor: es la única forma de escribir «Página 2 de 7».
      expect(footerHtml).toContain('class="pageNumber"');
      expect(footerHtml).toContain('class="totalPages"');
      // El texto institucional lo pone el TEMPLATE, que en la precedencia va por delante de la
      // marca. La marca de este arnés declara otro; el que gana es el del contrato.
      expect(footerHtml).toContain('Documento generado automáticamente por la plataforma ATLAS.');

      // Autocontenido (§25): ni hojas externas, ni scripts, ni una sola URL remota.
      expect(html).not.toMatch(/<link\b/);
      expect(html).not.toMatch(/<script\b/);
      expect(html).not.toMatch(/https?:\/\//);
      // Y ninguna expresión sin resolver: un `{{` en el HTML es un dato que no llegó.
      expect(html).not.toContain('{{');
    });

    it('repite la cabecera de las tablas largas y no parte las filas', async () => {
      await generate.execute({
        templateId: 'generic-result-report',
        payload: genericResultReportFixture(),
      });
      const { html } = harness.renderer.lastCall;

      // `<thead>` real, no una primera fila con estilo: es lo que permite que el motor la
      // repita en cada hoja. Sin él, las columnas pierden el nombre a partir de la página dos.
      expect(html).toContain('<thead>');
      expect(html).toContain('display: table-header-group');
      expect(html).toContain('break-inside: avoid');
      expect(html).toContain('page-break-before');
    });

    it('escapa el contenido del payload en vez de interpretarlo', async () => {
      await generate.execute({
        templateId: 'generic-result-report',
        payload: {
          title: '<img src=x onerror="alert(1)">',
          sections: [
            { title: 'Sección', fields: [{ label: 'Etiqueta', value: '<b>negrita</b>' }] },
          ],
        },
      });
      const { html } = harness.renderer.lastCall;
      expect(html).not.toContain('<img src=x');
      // Handlebars escapa también el `=` (`&#x3D;`), que es lo que impide reconstruir un
      // atributo aunque alguien lograse colar un `<`.
      expect(html).toContain('&lt;img src&#x3D;x');
      expect(html).toContain('&lt;b&gt;negrita&lt;/b&gt;');
    });

    it('respeta acentos, eñes y símbolos sin romperlos', async () => {
      await generate.execute({
        templateId: 'generic-result-report',
        payload: genericResultReportFixture(),
      });
      const { html } = harness.renderer.lastCall;
      expect(html).toContain('María José Núñez Peñaranda');
      expect(html).toContain('Evaluación automática');
      expect(html).toContain('charset="utf-8"');
    });

    it('imprime un guion en vez de «null», «undefined» o «[object Object]»', async () => {
      await generate.execute({
        templateId: 'generic-result-report',
        payload: {
          title: 'Vacíos',
          sections: [{ title: 'S', fields: [{ label: 'Sin dato', value: null }] }],
        },
      });
      const { html } = harness.renderer.lastCall;
      expect(html).not.toContain('undefined');
      expect(html).not.toContain('[object Object]');
      expect(html).toContain('—');
    });
  });

  describe('rechazos', () => {
    it('template inexistente', async () => {
      await expect(
        generate.execute({ templateId: 'no-existe', payload: {} }),
      ).rejects.toBeInstanceOf(TemplateNotFoundError);
    });

    it('versión inexistente', async () => {
      await expect(
        generate.execute({
          templateId: 'generic-result-report',
          templateVersion: '9.9.9',
          payload: {},
        }),
      ).rejects.toBeInstanceOf(TemplateVersionNotFoundError);
    });

    it('payload inválido: no llega a llamar al motor de impresión', async () => {
      const before = harness.renderer.calls.length;
      await expect(
        generate.execute({
          templateId: 'credit-analysis-report',
          payload: { customerName: 'Ana' },
        }),
      ).rejects.toBeInstanceOf(TemplatePayloadValidationError);
      // Validar ANTES de levantar nada es la mitad del diseño: el 90 % de los rechazos no
      // deben costar un carril de renderizado.
      expect(harness.renderer.calls.length).toBe(before);
    });

    it('enum inválido, con los valores admitidos en el error', async () => {
      try {
        await generate.execute({
          templateId: 'credit-analysis-report',
          payload: { customerName: 'Ana', score: 700, decision: 'APROBADO' },
        });
        throw new Error('debería haber lanzado');
      } catch (error) {
        const issues = (error as TemplatePayloadValidationError).issues;
        expect(issues.find((issue) => issue.field === 'decision')?.expected).toContain('APPROVED');
      }
    });

    it('unos bytes que no son un PDF se rechazan aunque tengan tamaño', async () => {
      const original = harness.renderer.render.bind(harness.renderer);
      harness.renderer.render = async (input) => ({
        ...(await original(input)),
        content: Buffer.from('<html>error del motor</html>'),
      });
      await expect(
        generate.execute({
          templateId: 'generic-result-report',
          payload: genericResultReportFixture(),
        }),
      ).rejects.toBeInstanceOf(PdfRenderError);
      harness.renderer.render = original;
    });
  });

  describe('idempotencia', () => {
    it('la segunda llamada con la misma clave repone el documento original', async () => {
      const command = {
        templateId: 'generic-result-report' as const,
        payload: genericResultReportFixture(),
        metadata: { idempotencyKey: 'pedido-4821-informe' },
      };
      const first = await generate.execute(command);
      const before = harness.renderer.calls.length;
      const second = await generate.execute(command);

      expect(second.status).toBe('REPLAYED');
      expect(second.documentId).toBe(first.documentId);
      expect(second.checksum).toBe(first.checksum);
      // No se volvió a imprimir: si se hubiera renderizado de nuevo, la fecha del pie cambiaría
      // y el checksum dejaría de coincidir con el que el consumidor ya archivó.
      expect(harness.renderer.calls.length).toBe(before);
    });

    it('la misma clave con OTRO payload genera un documento nuevo', async () => {
      const first = await generate.execute({
        templateId: 'generic-result-report',
        payload: { title: 'Uno', sections: [{ title: 'S' }] },
        metadata: { idempotencyKey: 'clave-reutilizada' },
      });
      const second = await generate.execute({
        templateId: 'generic-result-report',
        payload: { title: 'Dos', sections: [{ title: 'S' }] },
        metadata: { idempotencyKey: 'clave-reutilizada' },
      });
      expect(second.status).toBe('GENERATED');
      expect(second.documentId).not.toBe(first.documentId);
    });
  });

  describe('descubrimiento y vista previa', () => {
    it('publica el contrato de datos con campos, JSON Schema y ejemplo válido', () => {
      const definitions = harness.module.get(GetTemplateDefinitionUseCase);
      const schema = definitions.schema('credit-analysis-report', '1.0.0');

      expect(schema.fields.decision).toEqual(
        expect.objectContaining({
          type: 'enum',
          required: true,
          values: ['APPROVED', 'REJECTED', 'REVIEW'],
        }),
      );
      expect(schema.fields.amount.required).toBe(false);
      expect(schema.jsonSchema).toEqual(expect.objectContaining({ type: 'object' }));
      expect(schema.example).toEqual(expect.objectContaining({ customerName: expect.any(String) }));
    });

    it('conserva las versiones antiguas y marca la obsoleta', () => {
      const definitions = harness.module.get(GetTemplateDefinitionUseCase);
      expect(definitions.versions('credit-analysis-report')).toEqual(['1.0.0', '1.1.0']);
      expect(definitions.definition('credit-analysis-report', '1.0.0').deprecated?.replacedBy).toBe(
        'credit-analysis-report@1.1.0',
      );
    });

    it('la vista previa usa el fixture del template y nunca persiste', async () => {
      const preview = harness.module.get(PreviewTemplateUseCase);
      const result = await preview.execute({ templateId: 'generic-result-report' });
      expect(result.content).toBeInstanceOf(Buffer);
      expect(result.storage).toBeUndefined();
      expect(result.filename).toBe('preview-generic-result-report.pdf');
    });
  });
});
