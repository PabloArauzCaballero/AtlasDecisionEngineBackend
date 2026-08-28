/**
 * Declaración de `generic-result-report@1.0.0`.
 *
 * Esto es TODO lo que hay que escribir para publicar un documento nuevo, junto al esquema, la
 * plantilla y los estilos (§50). El motor central no se toca.
 *
 * `sourceDir: __dirname` es lo que ancla las plantillas a esta carpeta sin que ninguna ruta se
 * escriba a mano. Funciona igual desde `src/` (pruebas) que desde `dist/` (producción) porque
 * `nest-cli.json` copia los `.hbs` y los `.css` conservando la estructura.
 */
import { defineTemplate } from '../../../../domain/contracts/template-contract';
import { zodSchema } from '../../../../infrastructure/validation/zod-payload-schema';
import { genericResultReportFixture } from './preview.fixture';
import { GenericResultReportSchema } from './schema';

export const GenericResultReportTemplate = defineTemplate({
  id: 'generic-result-report',
  version: '1.0.0',
  title: 'Informe de resultado',
  description:
    'Documento genérico para publicar el resultado de cualquier algoritmo: cifras destacadas, ' +
    'avisos, secciones con campos y tablas. Pensado para que un artefacto entregue datos ' +
    'estructurados sin decidir nada sobre la maquetación.',
  sourceDir: __dirname,
  schema: zodSchema(GenericResultReportSchema),
  fixture: genericResultReportFixture,
  tags: ['generico', 'resultado', 'algoritmo'],
  classification: 'INTERNAL',
  page: { format: 'A4', orientation: 'portrait' },
  footer: {
    /*
     * Neutro a propósito: esta plantilla es la GENÉRICA y la usan varios productos de la casa
     * —el motor de decisión y el ERP—. Nombrar aquí al motor ponía su firma al pie de facturas
     * que no habían pasado por él. Quién firma el documento lo dice la marca (`brandId`), no la
     * plantilla; esto es sólo la nota de que el documento se generó solo.
     */
    institutionalText: 'Documento generado automáticamente por la plataforma ATLAS.',
    showGeneratedAt: true,
    showDocumentId: true,
    showPageNumbers: true,
  },
});
