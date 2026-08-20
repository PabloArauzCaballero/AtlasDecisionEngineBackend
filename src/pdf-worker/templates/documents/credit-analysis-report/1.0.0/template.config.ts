/**
 * Declaración de `credit-analysis-report@1.0.0`.
 *
 * Sigue REGISTRADO aunque exista la 1.1.0, y esa es la mitad que se olvida del §9: retirar una
 * versión antigua rompe la reproducción de todo lo que se emitió con ella. `deprecated` avisa
 * a quien empieza hoy sin dejar sin servicio a quien ya archivó cien informes.
 */
import { defineTemplate } from '../../../../domain/contracts/template-contract';
import { zodSchema } from '../../../../infrastructure/validation/zod-payload-schema';
import { creditAnalysisFixtureV1 } from './preview.fixture';
import { CreditAnalysisSchemaV1 } from './schema';

export const CreditAnalysisReportTemplateV1 = defineTemplate({
  id: 'credit-analysis-report',
  version: '1.0.0',
  title: 'Informe de análisis crediticio',
  description:
    'Veredicto del motor sobre una solicitud de crédito, con puntaje, decisión y los motivos ' +
    'que la sustentan.',
  sourceDir: __dirname,
  schema: zodSchema(CreditAnalysisSchemaV1),
  fixture: creditAnalysisFixtureV1,
  tags: ['credito', 'riesgo', 'decision'],
  classification: 'CONFIDENTIAL',
  page: { format: 'A4', orientation: 'portrait' },
  footer: {
    institutionalText: 'Contiene datos personales. Distribución restringida.',
    showGeneratedAt: true,
    showDocumentId: true,
    showPageNumbers: true,
  },
  deprecated: {
    since: '2026-02-11',
    reason: 'No incluye el desglose de factores del modelo, exigido por el comité de riesgos.',
    replacedBy: 'credit-analysis-report@1.1.0',
  },
});
