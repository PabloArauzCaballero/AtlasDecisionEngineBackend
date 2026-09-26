/** Declaración de `credit-analysis-report@1.1.0`: la 1.0.0 más el desglose de factores. */
import { defineTemplate } from '../../../../domain/contracts/template-contract';
import { zodSchema } from '../../../../infrastructure/validation/zod-payload-schema';
import { creditAnalysisFixtureV11 } from './preview.fixture';
import { CreditAnalysisSchemaV11 } from './schema';

export const CreditAnalysisReportTemplateV11 = defineTemplate({
  id: 'credit-analysis-report',
  version: '1.1.0',
  title: 'Informe de análisis crediticio',
  description:
    'Veredicto del motor sobre una solicitud de crédito, con puntaje, decisión, motivos y el ' +
    'desglose de la aportación de cada factor del modelo.',
  sourceDir: __dirname,
  schema: zodSchema(CreditAnalysisSchemaV11),
  fixture: creditAnalysisFixtureV11,
  tags: ['credito', 'riesgo', 'decision'],
  classification: 'CONFIDENTIAL',
  page: { format: 'A4', orientation: 'portrait' },
  footer: {
    institutionalText: 'Contiene datos personales. Distribución restringida.',
    showGeneratedAt: true,
    showDocumentId: true,
    showPageNumbers: true,
  },
});
