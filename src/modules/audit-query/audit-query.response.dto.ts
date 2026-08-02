import { ApiProperty } from '@nestjs/swagger';

/** Un eslabón que no verifica, con la razón por la que no lo hace. */
export class InvalidAuditEventDto {
  @ApiProperty({ example: '8891' })
  id!: string;

  @ApiProperty({
    example: 'PREVIOUS_HASH_MISMATCH',
    description:
      '`PREVIOUS_HASH_MISMATCH` (la cadena se rompió), `HASH_MISMATCH` (el evento fue alterado) o `HASH_KEY_UNAVAILABLE` (el secreto con el que se firmó ya no está configurado).',
  })
  reason!: string;
}

/**
 * Resultado de verificar la cadena de auditoría de un tenant.
 *
 * Se declara con detalle porque es la respuesta que un auditor consulta ante una reclamación,
 * y porque `valid: false` **no** significa siempre manipulación: un `HASH_KEY_UNAVAILABLE`
 * indica un secreto retirado que ya no se conserva, que es un problema de gestión de claves.
 */
export class AuditChainVerificationDto {
  @ApiProperty({ example: true, description: 'Falso si algún eslabón no verifica.' })
  valid!: boolean;

  @ApiProperty({ example: 1280, description: 'Eventos recorridos.' })
  eventCount!: number;

  @ApiProperty({
    example: 'c3d4e5f6...',
    nullable: true,
    description: 'Hash del último evento; `null` si el tenant no tiene ninguno.',
  })
  headHash!: string | null;

  @ApiProperty({ type: [InvalidAuditEventDto], description: 'Vacío cuando `valid` es cierto.' })
  invalid!: InvalidAuditEventDto[];
}

class CountByOutcomeDto {
  @ApiProperty({ example: 'APPROVED', nullable: true })
  outcome!: string | null;

  @ApiProperty({ example: 8421 })
  count!: number;
}

class CountByStatusDto {
  @ApiProperty({ example: 'SUCCEEDED' })
  status!: string;

  @ApiProperty({ example: 8600 })
  count!: number;
}

class DurationAggregateDto {
  @ApiProperty({ example: 42.7, nullable: true }) durationMs!: number | null;
}

/**
 * Agregado de latencia tal como lo devuelve hoy el endpoint.
 *
 * Los nombres `_avg`/`_max`/`_min` vienen del agregado de Prisma y se filtran sin mapear.
 * Se documenta **como es**, no como debería ser: renombrarlos rompería a los consumidores
 * actuales, y describirlos con nombres limpios haría que el contrato mintiera. Queda como
 * candidato a un cambio con deprecación previa.
 */
class LatencyAggregateDto {
  @ApiProperty({ type: DurationAggregateDto }) _avg!: DurationAggregateDto;
  @ApiProperty({ type: DurationAggregateDto }) _max!: DurationAggregateDto;
  @ApiProperty({ type: DurationAggregateDto }) _min!: DurationAggregateDto;
}

/** Agregados de ejecución del tenant, opcionalmente acotados a un artefacto. */
export class ExecutionMetricsDto {
  @ApiProperty({ example: 8600 }) total!: number;
  @ApiProperty({ type: [CountByOutcomeDto] }) outcomes!: CountByOutcomeDto[];
  @ApiProperty({ type: [CountByStatusDto] }) statuses!: CountByStatusDto[];
  @ApiProperty({ type: LatencyAggregateDto }) latencyMs!: LatencyAggregateDto;
}
