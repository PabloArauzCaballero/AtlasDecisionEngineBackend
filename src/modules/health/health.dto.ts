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

/**
 * Estado de las fuentes de datos registradas y de las reglas que las enrutan.
 *
 * Publica el nombre lógico, el motor, el rol y el veredicto. Nunca host, usuario, base ni
 * cadena de conexión: es un endpoint público y una sonda que dibuja la topología interna
 * es reconocimiento gratis para quien la consulta.
 */
export class DataSourcesResponseDto {
  @ApiProperty({ example: 'up', enum: ['up', 'degraded'] }) status!: string;
  @ApiProperty({
    description: 'Veredicto por conexión lógica.',
    example: {
      'postgres-write': { status: 'up', role: 'write', engine: 'postgresql', latencyMs: 2 },
      'postgres-read': { status: 'up', role: 'read', engine: 'postgresql', latencyMs: 1 },
      'redis-cache': { status: 'up', role: 'read-write', engine: 'redis', detail: 'redis' },
    },
    additionalProperties: true,
  })
  connections!: Record<string, unknown>;
  @ApiProperty({
    description: 'Reglas efectivas: qué conexión sirve la lectura y la escritura de cada módulo.',
    example: {
      default: { read: 'postgres-read', write: 'postgres-write', consistency: 'strong' },
      'audit-query': { read: 'postgres-read', write: 'postgres-write', consistency: 'eventual' },
    },
    additionalProperties: true,
  })
  routing!: Record<string, unknown>;
  @ApiProperty({ format: 'date-time' }) timestamp!: string;
}
