/**
 * Declaración de `propuesta-comercial@1.0.0`: la propuesta que el ERP envía a un comercio.
 *
 * Existía sólo como `generic-result-report`, y por eso llegaba encabezada «Informe de resultado ·
 * Uso interno», con «Este apartado no aporta datos» bajo cada párrafo y los pasos alineados a la
 * derecha: un informe de algoritmo, no una carta a un cliente. Esta plantilla dibuja su propia
 * portada de marca (de ahí `letterhead.mode: 'none'`), no lleva clasificación interna y su pie
 * no expone el identificador técnico del documento.
 */
import { defineTemplate } from '../../../../domain/contracts/template-contract';
import { zodSchema } from '../../../../infrastructure/validation/zod-payload-schema';
import { propuestaComercialFixture } from './preview.fixture';
import { PropuestaComercialSchema } from './schema';

export const PropuestaComercialTemplate = defineTemplate({
  id: 'propuesta-comercial',
  version: '1.0.0',
  title: 'Propuesta comercial',
  description:
    'Propuesta que recibe un comercio: portada de marca, carta, nota de quien la envía, ' +
    'beneficios, condiciones, cómo funciona, próximos pasos y firma.',
  sourceDir: __dirname,
  schema: zodSchema(PropuestaComercialSchema),
  fixture: propuestaComercialFixture,
  tags: ['comercial', 'crm', 'erp'],
  page: {
    format: 'Letter',
    orientation: 'portrait',
    // Carta a sangre completa: cada página pinta su propio fondo, sin márgenes ni pie corrido.
    margins: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
  },
  letterhead: { mode: 'none' },
  // Sin pie corrido: es una carta a sangre completa y cada página dibuja su propio pie.
  footer: { enabled: false },
});
