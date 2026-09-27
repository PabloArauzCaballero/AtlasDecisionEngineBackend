/**
 * `factura-fiscal@1.0.0`: lo que el papel AFIRMA según el estado, y lo que el contrato rechaza.
 *
 * Con el motor de impresión falso del arnés: se afirma sobre el HTML compuesto, que es donde un
 * texto fiscal de más (la frase de «Documento Fiscal Digital» en una representación interna) o
 * un QR que no es una imagen embebida se convertirían en un papel engañoso.
 */
import { GeneratePdfUseCase } from '../src/pdf-worker/application/use-cases/generate-pdf/generate-pdf.use-case';
import { GetTemplateDefinitionUseCase } from '../src/pdf-worker/application/use-cases/get-template-definition/get-template-definition.use-case';
import { TemplatePayloadValidationError } from '../src/pdf-worker/domain/errors/pdf-worker.errors';
import {
  facturaFiscalFixture,
  qrFicticioDataUri,
} from '../src/pdf-worker/templates/documents/factura-fiscal/1.0.0/preview.fixture';
import { FacturaFiscalSchema } from '../src/pdf-worker/templates/documents/factura-fiscal/1.0.0/schema';
import { createPdfWorkerHarness, type Harness } from './support/pdf-worker-harness';

const FRASE_DIGITAL =
  'Este documento es la Representación Gráfica de un Documento Fiscal Digital emitido en una modalidad de facturación en línea';
const FRASE_LEY =
  'ESTA FACTURA CONTRIBUYE AL DESARROLLO DEL PAÍS, EL USO ILÍCITO SERÁ SANCIONADO PENALMENTE DE ACUERDO A LEY';
const MARCA_INTERNA = 'REPRESENTACIÓN INTERNA — no es factura fiscal';

describe('factura-fiscal@1.0.0', () => {
  let harness: Harness;
  let generate: GeneratePdfUseCase;

  beforeAll(async () => {
    harness = await createPdfWorkerHarness();
    generate = harness.module.get(GeneratePdfUseCase);
  });

  afterAll(async () => {
    await harness.close();
  });

  async function componer(payload: unknown): Promise<string> {
    await generate.execute({ templateId: 'factura-fiscal', payload });
    return harness.renderer.lastCall.html;
  }

  async function rechazo(payload: unknown): Promise<TemplatePayloadValidationError> {
    const before = harness.renderer.calls.length;
    try {
      await generate.execute({ templateId: 'factura-fiscal', payload });
    } catch (error) {
      expect(error).toBeInstanceOf(TemplatePayloadValidationError);
      // Rechazado ANTES de imprimir: ningún carril de renderizado gastado.
      expect(harness.renderer.calls.length).toBe(before);
      return error as TemplatePayloadValidationError;
    }
    throw new Error('El payload debería haberse rechazado.');
  }

  describe('factura VALIDA', () => {
    it('imprime los datos fiscales, las leyendas y el QR embebido', async () => {
      const result = await generate.execute({
        templateId: 'factura-fiscal',
        payload: facturaFiscalFixture(),
      });
      expect(result.status).toBe('GENERATED');
      expect(result.template).toEqual({ id: 'factura-fiscal', version: '1.0.0' });

      const { html } = harness.renderer.lastCall;
      expect(html).toContain('>FACTURA<');
      expect(html).toContain('(Con Derecho a Crédito Fiscal)');
      expect(html).toContain('1003579028');
      expect(html).toContain('>123<');
      expect(html).toContain('46A1B2C3D4E5F60718293A4B5C6D7E8F9012345ABCDEF0123456789A');
      expect(html).toContain('FAC-CM-2026-000123');
      expect(html).toContain('CASA MATRIZ');
      expect(html).toContain('N° Punto de Venta 1');
      expect(html).toContain('Comisión por procesamiento de pagos QR');
      expect(html).toContain('1250.00');
      expect(html).toContain('Son: Mil doscientos cincuenta 00/100 Bolivianos');
      expect(html).toContain(FRASE_LEY);
      expect(html).toContain('Ley N° 453: El proveedor de servicios');
      expect(html).toContain(FRASE_DIGITAL);
      expect(html).toContain('class="ff-qr" src="data:image/svg+xml;base64,');

      // En la modalidad en línea el CUF sustituye al código de autorización.
      expect(html).not.toMatch(/c[oó]digo de autorizaci[oó]n/i);
      expect(html).not.toContain('REPRESENTACIÓN INTERNA');
      expect(html).not.toContain('fuera de línea');
      // Autocontenido: ni scripts ni URL remotas, tampoco dentro del QR.
      expect(html).not.toMatch(/<script\b/);
      expect(html).not.toMatch(/https?:\/\//);
      expect(html).not.toContain('{{');
    });

    it('el QR mide al menos 3 cm × 3 cm', async () => {
      const html = await componer(facturaFiscalFixture());
      const regla = /\.ff-qr\s*\{([^}]*)\}/.exec(html)?.[1] ?? '';
      const medida = (propiedad: string) =>
        Number(new RegExp(`(?:^|[\\s;])${propiedad}:\\s*([\\d.]+)cm`).exec(regla)?.[1] ?? 0);
      expect(medida('width')).toBeGreaterThanOrEqual(3);
      expect(medida('height')).toBeGreaterThanOrEqual(3);
    });

    it('sucursal distinta de 0, complemento, teléfono ausente y gift card', async () => {
      const base = facturaFiscalFixture();
      const html = await componer({
        ...base,
        emisor: { ...base.emisor, sucursal: 3, telefono: undefined },
        receptor: { ...base.receptor, complemento: '1A' },
        totales: { ...base.totales, montoGiftCard: '50.00', montoAPagar: '1200.00' },
      });
      expect(html).toContain('SUCURSAL N° 3');
      expect(html).not.toContain('CASA MATRIZ');
      expect(html).not.toContain('Teléfono:');
      expect(html).toContain('1234567019-1A');
      expect(html).toContain('MONTO GIFT CARD Bs');
      expect(html).toContain('50.00');
    });
  });

  describe('REPRESENTACION_INTERNA', () => {
    it('lleva la marca grande y NO la frase de documento fiscal digital', async () => {
      const html = await componer({ ...facturaFiscalFixture(), estado: 'REPRESENTACION_INTERNA' });
      expect(html).toContain(MARCA_INTERNA);
      expect(html).toContain('class="ff-interna"');
      expect(html).toContain('class="ff-filigrana"');
      expect(html).not.toContain(FRASE_DIGITAL);
      expect(html).not.toContain('Documento Fiscal Digital');
    });
  });

  describe('FUERA_DE_LINEA', () => {
    it('imprime la leyenda con el evento significativo', async () => {
      const html = await componer({
        ...facturaFiscalFixture(),
        estado: 'FUERA_DE_LINEA',
        eventoContingencia: 7,
      });
      expect(html).toContain('Factura emitida fuera de línea (evento N° 7)');
      expect(html).toContain(FRASE_DIGITAL);
      expect(html).not.toContain(MARCA_INTERNA);
    });

    it('sin eventoContingencia se rechaza', async () => {
      const error = await rechazo({ ...facturaFiscalFixture(), estado: 'FUERA_DE_LINEA' });
      expect(error.issues.map((issue) => issue.field)).toContain('eventoContingencia');
    });

    it('eventoContingencia en una factura VALIDA también se rechaza', async () => {
      const error = await rechazo({ ...facturaFiscalFixture(), eventoContingencia: 7 });
      expect(error.issues.map((issue) => issue.field)).toContain('eventoContingencia');
    });
  });

  describe('el QR sólo entra como imagen embebida', () => {
    it.each([
      ['una URL remota', 'https://siat.impuestos.gob.bo/consulta/QR?nit=1003579028'],
      ['un javascript:', 'javascript:alert(1)'],
      ['un data URI de HTML', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
      ['un data URI sin base64', 'data:image/svg+xml,<svg onload="alert(1)"></svg>'],
      ['un data URI con comillas', 'data:image/png;base64,AAAA" onerror="alert(1)'],
    ])('rechaza %s', async (_caso, qrDataUri) => {
      const error = await rechazo({ ...facturaFiscalFixture(), qrDataUri });
      expect(error.issues.map((issue) => issue.field)).toContain('qrDataUri');
    });

    it('acepta PNG y SVG en base64', () => {
      expect(
        FacturaFiscalSchema.safeParse({
          ...facturaFiscalFixture(),
          qrDataUri: 'data:image/png;base64,iVBORw0KGgo=',
        }).success,
      ).toBe(true);
      expect(qrFicticioDataUri()).toMatch(/^data:image\/svg\+xml;base64,/);
    });
  });

  describe('contrato', () => {
    it('rechaza importes como número o con coma decimal', async () => {
      const base = facturaFiscalFixture();
      const error = await rechazo({
        ...base,
        totales: { ...base.totales, montoTotal: 1250, montoAPagar: '1.250,00' },
      });
      const campos = error.issues.map((issue) => issue.field);
      expect(campos).toContain('totales.montoTotal');
      expect(campos).toContain('totales.montoAPagar');
    });

    it('rechaza un estado desconocido y un detalle vacío', async () => {
      const error = await rechazo({ ...facturaFiscalFixture(), estado: 'ACEPTADA', detalle: [] });
      const campos = error.issues.map((issue) => issue.field);
      expect(campos).toContain('estado');
      expect(campos).toContain('detalle');
    });

    it('publica el esquema con el enum de estados', () => {
      const definitions = harness.module.get(GetTemplateDefinitionUseCase);
      const schema = definitions.schema('factura-fiscal', '1.0.0');
      expect(schema.fields.estado).toEqual(
        expect.objectContaining({
          type: 'enum',
          required: true,
          values: ['VALIDA', 'FUERA_DE_LINEA', 'REPRESENTACION_INTERNA'],
        }),
      );
      expect(schema.fields.eventoContingencia.required).toBe(false);
      expect(schema.example).toEqual(expect.objectContaining({ estado: 'VALIDA' }));
    });
  });

  describe('escapado', () => {
    it('una razón social con <script> sale como texto', async () => {
      const base = facturaFiscalFixture();
      const html = await componer({
        ...base,
        emisor: { ...base.emisor, razonSocial: '<script>alert(1)</script> S.A.' },
        receptor: { ...base.receptor, nombreRazonSocial: '<img src=x onerror="alert(1)">' },
      });
      expect(html).not.toMatch(/<script\b/);
      expect(html).not.toContain('<img src=x');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; S.A.');
      expect(html).toContain('&lt;img src&#x3D;x onerror&#x3D;&quot;alert(1)&quot;&gt;');
    });
  });
});
