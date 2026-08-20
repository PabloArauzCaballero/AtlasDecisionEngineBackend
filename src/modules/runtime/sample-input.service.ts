/**
 * Genera valores de prueba para el simulador a partir del contrato REAL del artefacto
 * desplegado (§10).
 *
 * Reutiliza el generador del QA Lab, pero a diferencia de él NO ejecuta nada ni persiste
 * corrida alguna: aquí el resultado es la entrada, para que el analista la revise, la
 * retoque y decida si simula. Son dos necesidades distintas —«pruébame mil casos» y
 * «rellename este formulario»— y mezclarlas obligaría a archivar una corrida de QA cada
 * vez que alguien quiere un ejemplo.
 *
 * El contrato se resuelve por el mismo despliegue que usará la simulación y no por el
 * catálogo de variables: si se generara contra otro contrato, el botón produciría
 * entradas que el simulador rechaza acto seguido.
 */
import { HttpStatus, Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain-exception';
import { DeploymentResolverService } from '../deployments/deployment-resolver.service';
import type { CompiledDecisionArtifact } from '../graph/graph.types';
import type { GeneratorContractVariable } from '../qa-lab/contract-generator';
import { buildSampleBatch, seedSequence, type SampleBatch } from '../qa-lab/sample-inputs';
import { GenerateSampleInputsDto } from './simulation.dto';

export interface SampleInputsResult extends SampleBatch {
  artifactCode: string;
  environmentCode: string;
  versionId: string;
}

@Injectable()
export class SampleInputService {
  // Uno por servicio, no por petición: el contador es lo que separa dos pulsaciones caídas
  // en el mismo milisegundo, y reiniciarlo en cada llamada lo dejaría siempre en 1.
  private readonly nextSeed = seedSequence('simulator-sample');

  constructor(private readonly deployments: DeploymentResolverService) {}

  async generate(
    tenantId: bigint,
    artifactCode: string,
    dto: GenerateSampleInputsDto,
  ): Promise<SampleInputsResult> {
    const environmentCode = dto.environmentCode.toUpperCase();
    if (environmentCode === 'PROD') {
      throw new DomainException(
        'SIMULATION_PROD_FORBIDDEN',
        'El simulador no opera sobre PROD, tampoco para generar valores de prueba',
        HttpStatus.FORBIDDEN,
      );
    }

    const deployment = await this.deployments.resolve(tenantId, artifactCode, environmentCode);
    const compiled = deployment.compiled;
    const inputs = this.inputContract(compiled);
    if (!inputs.length) {
      throw new DomainException(
        'ARTIFACT_HAS_NO_INPUTS',
        `El artefacto ${artifactCode} no declara variables de entrada, así que no hay valores que generar`,
        HttpStatus.CONFLICT,
      );
    }

    // El grafo compilado va también: `kind: 'OUTCOMES'` construye un caso por cada
    // desenlace, y para eso hacen falta los nodos y las condiciones, no sólo el contrato.
    const batch = buildSampleBatch(inputs, dto, this.nextSeed, compiled);
    return {
      ...batch,
      artifactCode,
      environmentCode: deployment.environmentCode,
      versionId: deployment.artifactVersionId.toString(),
    };
  }

  private inputContract(compiled: CompiledDecisionArtifact): GeneratorContractVariable[] {
    return compiled.variables
      .filter((variable) => !String(variable.usageType ?? 'INPUT').startsWith('OUTPUT'))
      .map((variable) => ({
        code: variable.code,
        dataType: variable.dataType,
        required: variable.required,
        nullable: variable.nullable,
        defaultValue: variable.defaultValue,
        constraints: variable.constraints ?? variable.validationSchema,
      }));
  }
}
