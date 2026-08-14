/**
 * Cliente en proceso: el worker vive dentro de este mismo NestJS.
 *
 * Es una llamada de función, sin serialización ni red, y por tanto sin la clase de fallo que
 * más cuesta diagnosticar en un generador de documentos: el tiempo de espera de una petición
 * HTTP interna que se agota mientras el PDF se estaba generando bien.
 *
 * Devuelve el búfer por defecto. Es lo que quiere quien llama desde el mismo proceso —adjuntar
 * el documento a un correo, guardarlo en su propio expediente— y no hay coste de transporte
 * que lo desaconseje.
 */
import { Injectable } from '@nestjs/common';
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
import { GeneratePdfUseCase } from '../application/use-cases/generate-pdf/generate-pdf.use-case';
import { GetTemplateDefinitionUseCase } from '../application/use-cases/get-template-definition/get-template-definition.use-case';
import { PreviewTemplateUseCase } from '../application/use-cases/preview-template/preview-template.use-case';
import { ValidatePayloadUseCase } from '../application/use-cases/validate-template/validate-payload.use-case';
import type { PdfGeneratorPort } from './pdf-generator.port';

@Injectable()
export class LocalPdfGeneratorAdapter implements PdfGeneratorPort {
  constructor(
    private readonly generateUseCase: GeneratePdfUseCase,
    private readonly previewUseCase: PreviewTemplateUseCase,
    private readonly definitions: GetTemplateDefinitionUseCase,
    private readonly validation: ValidatePayloadUseCase,
  ) {}

  async generate<TPayload>(command: GeneratePdfCommand<TPayload>): Promise<GeneratePdfResult> {
    return this.generateUseCase.execute({
      ...command,
      options: { returnContent: true, ...command.options },
    });
  }

  async preview(command: PreviewTemplateCommand): Promise<GeneratePdfResult> {
    return this.previewUseCase.execute(command);
  }

  async listTemplates(tag?: string): Promise<readonly TemplateSummary[]> {
    return this.definitions.list(tag);
  }

  async describeTemplate(templateId: string, version?: string): Promise<TemplateSchemaResult> {
    return this.definitions.schema(templateId, version);
  }

  async validate(
    templateId: string,
    payload: unknown,
    version?: string,
  ): Promise<ValidatePayloadResult> {
    return this.validation.execute({ templateId, templateVersion: version, payload });
  }
}
