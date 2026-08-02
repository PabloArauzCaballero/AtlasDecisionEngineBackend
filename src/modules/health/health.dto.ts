import { ApiProperty } from '@nestjs/swagger';

/**
 * Forma publicada de las sondas.
 *
 * Se declara aunque el controlador no la use para validar entrada: sin un tipo en la
 * respuesta el contrato OpenAPI describe la operación pero no su cuerpo, y un consumidor
 * —incluido el orquestador de contenedores— tendría que deducirlo probando.
 */
export class LivenessResponseDto {
  @ApiProperty({ example: 'ok' }) status!: string;
  @ApiProperty({ example: 'atlas-decision-engine-backend' }) service!: string;
  /** Reparto de responsabilidades del proceso que responde: ALL, API o WORKER. */
  @ApiProperty({ example: 'API' }) role!: string;
  @ApiProperty({ example: '2.0.0' }) version!: string;
  @ApiProperty({ example: 'a1b2c3d' }) commit!: string;
  @ApiProperty({ example: 3_600 }) uptimeSeconds!: number;
  @ApiProperty({ format: 'date-time' }) timestamp!: string;
}

export class ReadinessResponseDto {
  @ApiProperty({ example: 'ready' }) status!: string;
  /**
   * Resultado por dependencia. Solo el nombre de la comprobación y su veredicto: el texto
   * crudo del driver revelaría host, puerto y versión en un endpoint público.
   */
  @ApiProperty({
    example: { database: 'ok', cache: 'redis' },
    additionalProperties: { type: 'string' },
  })
  checks!: Record<string, string>;
  @ApiProperty({ format: 'date-time' }) timestamp!: string;
}
