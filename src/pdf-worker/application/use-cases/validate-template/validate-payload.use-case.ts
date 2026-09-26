/**
 * Validación sin generar (§45, casos «payload inválido» y «campo requerido faltante»).
 *
 * Existe para que un artefacto pueda comprobar su payload en su propia batería de pruebas sin
 * levantar un navegador ni producir un archivo. Devuelve el veredicto en el cuerpo —no lanza—
 * porque aquí «inválido» es la respuesta correcta a la pregunta, no un fallo de la llamada.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ValidatePayloadCommand } from '../../dto/generate-pdf.command';
import type { ValidatePayloadResult } from '../../dto/generate-pdf.result';
import {
  TEMPLATE_REPOSITORY_PORT,
  type TemplateRepositoryPort,
} from '../../ports/template-repository.port';

@Injectable()
export class ValidatePayloadUseCase {
  constructor(
    @Inject(TEMPLATE_REPOSITORY_PORT) private readonly templates: TemplateRepositoryPort,
  ) {}

  execute(command: ValidatePayloadCommand): ValidatePayloadResult {
    const contract = this.templates.getTemplate(command.templateId, command.templateVersion);
    const parsed = contract.schema.parse(command.payload);
    return {
      valid: parsed.ok,
      templateId: contract.id,
      version: contract.version,
      issues: parsed.ok ? [] : parsed.issues,
    };
  }
}
