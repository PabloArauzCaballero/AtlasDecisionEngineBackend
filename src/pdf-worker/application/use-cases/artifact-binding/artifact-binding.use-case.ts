/**
 * Casar un documento con un artefacto, a nivel de datos.
 *
 * Dos operaciones y las dos responden a la misma pregunta desde lados opuestos:
 *
 *   `compatibility()` — ¿lo que este artefacto RESPONDE lo acepta este documento?
 *   `sampleFrom()`    — dame un dato de prueba construido con la salida REAL de
 *                       este artefacto, para verlo impreso antes de que exista
 *                       ninguna decisión.
 *
 * Lo segundo es lo que sustituye al ejemplo escrito a mano: un fixture inventado
 * demuestra que la plantilla maqueta, no que sirva para el artefacto que la va a
 * usar. Construido desde el contrato de salida, si falta un campo se ve aquí.
 *
 * Un artefacto puede alimentar VARIOS documentos y un documento puede declarar
 * varios artefactos compatibles: la relación es de muchos a muchos y ninguna de
 * las dos direcciones se colapsa.
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  checkCompatibility,
  type CompatibilityReport,
} from '../../../domain/services/artifact-compatibility';
import {
  ArtifactContractUnavailableError,
  ArtifactNotFoundError,
} from '../../../domain/errors/pdf-worker.errors';
import {
  ARTIFACT_CONTRACT_PORT,
  type ArtifactContractPort,
  type ArtifactSummary,
} from '../../ports/artifact-contract.port';
import {
  TEMPLATE_REPOSITORY_PORT,
  type TemplateRepositoryPort,
} from '../../ports/template-repository.port';

export interface ArtifactSampleResult {
  readonly templateId: string;
  readonly artifactId: string;
  readonly artifactVersion: string;
  /** Payload listo para `POST /pdf/generate`, con los ejemplos del artefacto. */
  readonly payload: Record<string, unknown>;
  /** Campos del documento que el artefacto no pudo rellenar. */
  readonly missing: readonly string[];
  readonly compatibility: CompatibilityReport;
}

@Injectable()
export class ArtifactBindingUseCase {
  constructor(
    @Inject(TEMPLATE_REPOSITORY_PORT) private readonly templates: TemplateRepositoryPort,
    @Inject(ARTIFACT_CONTRACT_PORT) private readonly artifacts: ArtifactContractPort,
  ) {}

  async listArtifacts(): Promise<readonly ArtifactSummary[]> {
    this.assertAvailable();
    return this.artifacts.list();
  }

  async compatibility(
    templateId: string,
    artifactId: string,
    templateVersion?: string,
    artifactVersion?: string,
  ): Promise<CompatibilityReport> {
    this.assertAvailable();
    const contract = this.templates.getTemplate(templateId, templateVersion);
    const output = await this.artifacts.get(artifactId, artifactVersion);
    if (!output) throw new ArtifactNotFoundError(artifactId, artifactVersion);

    return checkCompatibility({
      templateId: contract.id,
      templateVersion: contract.version,
      templateFields: contract.schema.describeFields(),
      artifactId: output.artifactId,
      artifactVersion: output.artifactVersion,
      artifactFields: output.fields.map((field) => ({
        fieldCode: field.fieldCode,
        type: field.type,
        required: field.required,
        allowedValues: field.allowedValues,
      })),
    });
  }

  /**
   * Dato de prueba construido con los ejemplos que declara el artefacto.
   *
   * Sólo se copian los campos que el documento pide: meter la salida entera
   * produciría un payload con claves que el contrato del template no declara, y
   * el motor lo rechazaría por estricto — un dato de prueba que no se puede usar.
   */
  async sampleFrom(
    templateId: string,
    artifactId: string,
    templateVersion?: string,
    artifactVersion?: string,
  ): Promise<ArtifactSampleResult> {
    this.assertAvailable();
    const contract = this.templates.getTemplate(templateId, templateVersion);
    const output = await this.artifacts.get(artifactId, artifactVersion);
    if (!output) throw new ArtifactNotFoundError(artifactId, artifactVersion);

    const porCodigo = new Map(output.fields.map((field) => [field.fieldCode, field]));
    const payload: Record<string, unknown> = {};
    const missing: string[] = [];

    for (const [name, descriptor] of Object.entries(contract.schema.describeFields())) {
      const field = porCodigo.get(name);
      if (field?.example !== undefined) {
        payload[name] = field.example;
        continue;
      }
      // Se anota lo que falta en vez de rellenarlo con un valor plausible: un
      // hueco inventado convierte la prueba en una demostración de que la
      // plantilla pinta cualquier cosa, que es lo contrario de lo que se quiere.
      if (descriptor.required) missing.push(name);
    }

    return {
      templateId: contract.id,
      artifactId: output.artifactId,
      artifactVersion: output.artifactVersion,
      payload,
      missing,
      compatibility: await this.compatibility(
        templateId,
        artifactId,
        templateVersion,
        artifactVersion,
      ),
    };
  }

  private assertAvailable(): void {
    if (!this.artifacts.available) throw new ArtifactContractUnavailableError();
  }
}
