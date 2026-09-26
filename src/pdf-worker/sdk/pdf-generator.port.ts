/**
 * El contrato que ve un consumidor (§43, §44).
 *
 * Un algoritmo del ecosistema depende de ESTO y de nada más. No sabe si el worker vive en su
 * mismo proceso o al otro lado de la red, ni si detrás hay Playwright o un servicio de
 * impresión. Esa ignorancia es el objetivo: el día que el generador se saque a su propio
 * despliegue, el algoritmo no cambia una línea — cambia qué implementación se registra.
 *
 * `generate` acepta un parámetro de tipo para el payload. No añade validación en ejecución
 * —ésa la hace el contrato del template, que es la autoridad— pero convierte un cambio de
 * contrato en un error de compilación en el consumidor cuando éste importa el tipo del
 * template, en vez de en un 422 descubierto en producción.
 */
import type {
  GeneratePdfCommand,
  PreviewTemplateCommand,
} from '../application/dto/generate-pdf.command';
import type {
  GeneratePdfResult,
  TemplateSchemaResult,
  ValidatePayloadResult,
} from '../application/dto/generate-pdf.result';
import type { TemplateSummary } from '../domain/contracts/template-contract';

export interface PdfGeneratorPort {
  generate<TPayload>(command: GeneratePdfCommand<TPayload>): Promise<GeneratePdfResult>;
  preview(command: PreviewTemplateCommand): Promise<GeneratePdfResult>;
  /** Descubrimiento: qué documentos hay y qué exige cada uno (§19). */
  listTemplates(tag?: string): Promise<readonly TemplateSummary[]>;
  describeTemplate(templateId: string, version?: string): Promise<TemplateSchemaResult>;
  /** Comprobar el payload sin generar: pensado para las pruebas del consumidor. */
  validate(templateId: string, payload: unknown, version?: string): Promise<ValidatePayloadResult>;
}

export const PDF_GENERATOR_PORT = Symbol('PdfGeneratorPort');
