/**
 * Compone el documento y se detiene ANTES de imprimir.
 *
 * Sirve a dos cosas concretas:
 *
 *  - **Regresión visual (§46).** El PDF no es comparable byte a byte: Chromium le pone una
 *    `/CreationDate` y dos ejecuciones del mismo documento dan archivos distintos. El HTML
 *    compuesto SÍ es determinista si se fija el reloj, así que la huella se toma sobre él. Lo
 *    que eso cubre —y lo que no— está escrito en `visual-baseline.ts`.
 *  - **Depurar una maqueta.** Ver el HTML en un navegador con las herramientas de desarrollo
 *    abiertas es incomparablemente más rápido que deducir por qué una tabla se parte mirando
 *    el PDF resultante.
 *
 * No se expone por HTTP. Devolver el HTML compuesto a un cliente sería devolverle el logotipo
 * en base64 y la fuente entera, y sobre todo daría la falsa impresión de ser un formato de
 * salida soportado.
 */
import { Inject, Injectable } from '@nestjs/common';
import { BRAND_REPOSITORY_PORT, type BrandRepositoryPort } from '../../ports/brand-repository.port';
import { PDF_WORKER_SETTINGS, type PdfWorkerSettings } from '../../ports/settings.port';
import { CLOCK_PORT, type ClockPort } from '../../ports/runtime.ports';
import {
  TEMPLATE_REPOSITORY_PORT,
  type TemplateRepositoryPort,
} from '../../ports/template-repository.port';
import { TemplatePayloadValidationError } from '../../../domain/errors/pdf-worker.errors';
import { buildComposeInput } from '../../services/compose-input';
import { DocumentComposer, type ComposedDocument } from '../../services/document-composer';

export interface ComposeHtmlCommand {
  readonly templateId: string;
  readonly templateVersion?: string;
  readonly brandId?: string;
  readonly payload?: unknown;
  /** Identificador fijo: sin él, cada composición cambia y la huella no serviría de nada. */
  readonly documentId?: string;
}

@Injectable()
export class ComposeHtmlUseCase {
  constructor(
    @Inject(TEMPLATE_REPOSITORY_PORT) private readonly templates: TemplateRepositoryPort,
    @Inject(BRAND_REPOSITORY_PORT) private readonly brands: BrandRepositoryPort,
    @Inject(PDF_WORKER_SETTINGS) private readonly settings: PdfWorkerSettings,
    @Inject(CLOCK_PORT) private readonly clock: ClockPort,
    private readonly composer: DocumentComposer,
  ) {}

  async execute(command: ComposeHtmlCommand): Promise<ComposedDocument> {
    const contract = this.templates.getTemplate(command.templateId, command.templateVersion);
    const brand = command.brandId ? this.brands.get(command.brandId) : this.brands.getDefault();

    const parsed = contract.schema.parse(command.payload ?? contract.fixture());
    if (!parsed.ok) {
      throw new TemplatePayloadValidationError(contract.id, contract.version, parsed.issues);
    }

    return this.composer.compose(
      buildComposeInput({
        contract,
        brand,
        data: parsed.value,
        documentId: command.documentId ?? 'DOC-000000000000',
        createdAt: this.clock.now(),
        settings: this.settings,
      }),
    );
  }
}
