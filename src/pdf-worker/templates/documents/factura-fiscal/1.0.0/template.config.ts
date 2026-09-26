/**
 * Declaración de `factura-fiscal@1.0.0`: la representación gráfica de la factura de compra-venta
 * del SIN que emite el ERP (`FiscalPdfService`), en línea o fuera de línea, y la «interna» cuando
 * no hay documento fiscal válido detrás.
 *
 * Misma receta que el resto: esquema, plantilla, estilos, fixture y una línea en el catálogo.
 */
import { defineTemplate } from '../../../../domain/contracts/template-contract';
import { zodSchema } from '../../../../infrastructure/validation/zod-payload-schema';
import { facturaFiscalFixture } from './preview.fixture';
import { FacturaFiscalSchema } from './schema';

export const FacturaFiscalTemplate = defineTemplate({
  id: 'factura-fiscal',
  version: '1.0.0',
  title: 'Factura',
  description:
    'Representación gráfica de una factura de compra-venta boliviana (SIN, modalidad en línea): ' +
    'emisor, NIT, número fiscal, CUF, receptor, detalle, totales, leyenda de la Ley N° 453 y QR ' +
    'de verificación. Marca la emisión fuera de línea y la representación interna sin validez fiscal.',
  sourceDir: __dirname,
  schema: zodSchema(FacturaFiscalSchema),
  fixture: facturaFiscalFixture,
  tags: ['facturacion', 'fiscal', 'siat', 'erp'],
  page: { format: 'Letter', orientation: 'portrait' },
  footer: {
    showGeneratedAt: true,
    showDocumentId: true,
    showPageNumbers: true,
  },
});
