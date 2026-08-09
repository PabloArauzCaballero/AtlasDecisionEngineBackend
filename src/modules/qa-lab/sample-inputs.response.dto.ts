/**
 * Forma de un lote de valores de prueba en el contrato OpenAPI.
 *
 * Vive en un fichero propio y no en `qa-lab.response.dto.ts` porque lo comparten dos
 * controladores —el del simulador y el del QA Lab— y describe un concepto propio: la
 * entrada generada, que no es ni una corrida ni un contraejemplo.
 */
import { ApiProperty } from '@nestjs/swagger';

export class SampleCaseDto {
  @ApiProperty({ example: 0, description: 'Posición dentro del lote, empezando en 0.' })
  index!: number;

  @ApiProperty({ example: 'BOUNDARY', enum: ['VALID', 'BOUNDARY', 'INVALID'] })
  kind!: string;

  @ApiProperty({
    required: false,
    example: 'ingreso_mensual: por encima del máximo',
    description: 'Qué se manipuló para llevar el caso al límite o hacerlo inválido.',
  })
  mutation?: string;

  @ApiProperty({
    example: { ingreso_mensual: 4200.5, edad: 33 },
    description: 'Entradas generadas, listas para simular o para guardar como caso.',
  })
  input!: Record<string, unknown>;

  @ApiProperty({
    required: false,
    type: [String],
    example: ['correo_contacto'],
    description:
      'Variables cuyo contrato es contradictorio (p. ej. formato EMAIL con maxLength 4): ningún valor puede satisfacerlo, así que el valor entregado para ellas NO es válido. Lo que hay que corregir es el contrato.',
  })
  unsatisfiable?: string[];
}

/** Lo común a los dos caminos: qué se generó y cómo volver a generarlo igual. */
class SampleBatchDto {
  @ApiProperty({ example: 'VALID', enum: ['VALID', 'BOUNDARY', 'INVALID'] })
  kind!: string;

  @ApiProperty({
    example: 'k3f2m1a',
    description: 'Reenviarla en otra petición devuelve exactamente los mismos valores.',
  })
  seed!: string;

  @ApiProperty({ example: 'atlas-qa-generator-1.2.0' })
  generatorVersion!: string;

  @ApiProperty({ type: [SampleCaseDto] })
  cases!: SampleCaseDto[];
}

/** `SampleInputService.generate`: contrato tomado del despliegue del ambiente. */
export class SimulatorSampleInputsDto extends SampleBatchDto {
  @ApiProperty({ example: 'BNPL_CREDIT_DECISION' }) artifactCode!: string;

  @ApiProperty({ example: 'DEV', description: 'Ambiente resuelto. PROD nunca.' })
  environmentCode!: string;

  @ApiProperty({ example: '4001', description: 'Versión desplegada de la que salió el contrato.' })
  versionId!: string;
}

/** `QaLabService.sampleInputs`: contrato tomado de la versión compilada, sin ambiente. */
export class VersionSampleInputsDto extends SampleBatchDto {
  @ApiProperty({ example: '4001' }) versionId!: string;
}
