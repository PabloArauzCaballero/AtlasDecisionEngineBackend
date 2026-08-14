/**
 * El catálogo: la ÚNICA lista de templates publicados.
 *
 * Añadir un documento es añadir una línea aquí. Ni el módulo, ni los casos de uso, ni el
 * controlador cambian — que es literalmente el criterio de aceptación del §50.
 *
 * Las versiones antiguas siguen en la lista. Quitarlas «para limpiar» rompería la reproducción
 * de todo lo emitido con ellas, que es lo único que un archivo documental promete.
 */
import type { TemplateContract } from '../domain/contracts/template-contract';
import { CreditAnalysisReportTemplateV1 } from './documents/credit-analysis-report/1.0.0/template.config';
import { CreditAnalysisReportTemplateV11 } from './documents/credit-analysis-report/1.1.0/template.config';
import { GenericResultReportTemplate } from './documents/generic-result-report/1.0.0/template.config';

export const TEMPLATE_CATALOG: readonly TemplateContract[] = [
  GenericResultReportTemplate as TemplateContract,
  CreditAnalysisReportTemplateV1 as TemplateContract,
  CreditAnalysisReportTemplateV11 as TemplateContract,
];
