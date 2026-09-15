/**
 * Declaración de `blank-form@1.0.0`: el formulario en blanco para rellenar a mano.
 *
 * Misma receta que `generic-result-report`: esquema, plantilla, estilos, fixture y una línea en
 * el catálogo. El motor central no se toca (§50); lo único añadido fuera de esta carpeta es el
 * helper `times`, porque un formulario imprime N renglones vacíos y Handlebars no sabe contar.
 */
import { defineTemplate } from '../../../../domain/contracts/template-contract';
import { zodSchema } from '../../../../infrastructure/validation/zod-payload-schema';
import { blankFormFixture } from './preview.fixture';
import { BlankFormSchema } from './schema';

export const BlankFormTemplate = defineTemplate({
  id: 'blank-form',
  version: '1.0.0',
  title: 'Formulario para rellenar a mano',
  description:
    'Formulario en blanco derivado de una pantalla del ERP: casillas, fechas, opciones para ' +
    'marcar y renglones vacíos, con código de formulario, versión y número de serie para que ' +
    'el papel se pueda transcribir después al sistema.',
  sourceDir: __dirname,
  schema: zodSchema(BlankFormSchema),
  fixture: blankFormFixture,
  tags: ['formulario', 'papel', 'erp'],
  classification: 'INTERNAL',
  page: { format: 'A4', orientation: 'portrait' },
  footer: {
    institutionalText: 'Formulario emitido por la plataforma ATLAS para su llenado manual.',
    showGeneratedAt: true,
    showDocumentId: true,
    showPageNumbers: true,
  },
});
