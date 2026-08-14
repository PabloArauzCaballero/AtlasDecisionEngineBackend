/**
 * Previsualización con datos ficticios (§21).
 *
 * Delega en `GeneratePdfUseCase` en vez de tener su propio camino. Es la diferencia entre una
 * previsualización que comprueba algo y una que no: si la vista previa tuviera su propia
 * composición, podría salir perfecta mientras la generación real falla — y ese es justo el
 * fallo que una vista previa existe para adelantar.
 *
 * Nunca persiste y nunca publica un `PDF_GENERATED` con apariencia de documento real: se marca
 * con un identificador propio y `persist: false`.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PreviewTemplateCommand } from '../../dto/generate-pdf.command';
import type { GeneratePdfResult } from '../../dto/generate-pdf.result';
import {
  TEMPLATE_REPOSITORY_PORT,
  type TemplateRepositoryPort,
} from '../../ports/template-repository.port';
import { GeneratePdfUseCase } from '../generate-pdf/generate-pdf.use-case';

@Injectable()
export class PreviewTemplateUseCase {
  constructor(
    @Inject(TEMPLATE_REPOSITORY_PORT) private readonly templates: TemplateRepositoryPort,
    private readonly generate: GeneratePdfUseCase,
  ) {}

  async execute(command: PreviewTemplateCommand): Promise<GeneratePdfResult> {
    const contract = this.templates.getTemplate(command.templateId, command.templateVersion);
    // El payload alternativo pasa por el MISMO contrato. Una vista previa que acepta datos
    // que la generación rechazaría enseña un documento que nunca se podrá emitir.
    const payload = command.payload ?? contract.fixture();

    return this.generate.execute({
      templateId: contract.id,
      templateVersion: contract.version,
      brandId: command.brandId,
      payload,
      metadata: {
        requestedBy: 'preview',
        locale: command.locale,
        timezone: command.timezone,
      },
      options: { persist: false, filename: `preview-${contract.id}`, returnContent: true },
    });
  }
}
