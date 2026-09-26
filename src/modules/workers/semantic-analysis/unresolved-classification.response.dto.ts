/**
 * Forma de la bandeja de pendientes de clasificación en el contrato OpenAPI.
 *
 * El valor crudo va tal cual llegó porque es lo que hay que reconocer para decidir; por eso
 * se recorta en las notificaciones pero no aquí, donde lo lee quien tiene permiso para
 * resolverlo.
 */
import { ApiProperty } from '@nestjs/swagger';

export class UnresolvedClassificationDto {
  @ApiProperty({ example: '4821' }) id!: string;

  @ApiProperty({ example: 'DEBITO POS / CAPACITACION ACADEMIA 21 / MCC 8299' })
  rawValue!: string;

  @ApiProperty({
    example: 'debito pos capacitacion academia 21 mcc 8299',
    description: 'El mismo texto normalizado; es la clave por la que se busca y se deduplica.',
  })
  normalizedValue!: string;

  @ApiProperty({ example: 'semantic-analysis', description: 'Quién encoló el valor.' })
  source!: string;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Contexto que aportó el emisor (ejecución, documento, movimiento).',
  })
  context!: unknown;

  @ApiProperty({
    required: false,
    nullable: true,
    example: 'GASTOS.EDUCACION',
    description: 'Candidata del motor. `null` cuando ninguna llegó al umbral.',
  })
  suggestedCategoryCode!: string | null;

  @ApiProperty({ required: false, nullable: true, example: 0.61 })
  confidence!: number | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Resto de candidatas con su confianza, para decidir con lo mismo que vio el motor.',
  })
  alternatives!: unknown;

  @ApiProperty({ example: 5, description: 'Cuántas veces llegó este mismo valor.' })
  occurrenceCount!: number;

  @ApiProperty({ example: '2026-08-02T23:37:45.254Z' }) firstSeenAt!: Date;

  @ApiProperty({ example: '2026-08-10T11:02:00.000Z' }) lastSeenAt!: Date;

  @ApiProperty({ example: 'PENDING', enum: ['PENDING', 'RESOLVED', 'IGNORED', 'REJECTED'] })
  status!: string;

  @ApiProperty({ required: false, nullable: true, example: 'GASTOS.EDUCACION' })
  resolvedCategoryCode!: string | null;

  @ApiProperty({ required: false, nullable: true, example: 'usuario@atlas.internal' })
  resolvedBy!: string | null;

  @ApiProperty({ required: false, nullable: true, example: '2026-08-10T12:00:00.000Z' })
  resolvedAt!: Date | null;

  @ApiProperty({ required: false, nullable: true, example: 'ASSIGN' })
  resolutionType!: string | null;
}

/** `GET /unresolved/count`: lo que alimenta el contador de la pestaña. */
export class UnresolvedCountsDto {
  @ApiProperty({ example: 72 }) pending!: number;
}

/** Resultado de la última pasada de reevaluación terminada en este proceso. */
export class ReevaluationSummaryDto {
  @ApiProperty({ example: 72 }) revisados!: number;
  @ApiProperty({ example: 18, description: 'Los que el catálogo de hoy ya sabe clasificar.' })
  resueltos!: number;
  @ApiProperty({ example: 6, description: 'Los que cambiaron de recomendación sin resolverse.' })
  refrescados!: number;
  @ApiProperty({ example: 54 }) pendientes!: number;
}

/**
 * Estado de la reevaluación. Los nombres van en español porque son los del servicio y del
 * cliente que ya los consume: traducirlos sólo en el contrato dejaría dos vocabularios
 * para el mismo campo, que es peor que uno en el idioma del equipo.
 */
export class ReevaluationStateDto {
  @ApiProperty({ example: true, description: 'Hay una pasada en curso para este tenant.' })
  corriendo!: boolean;

  @ApiProperty({ example: 54, description: 'Cuántos siguen PENDING ahora mismo.' })
  pendientes!: number;

  @ApiProperty({
    required: false,
    nullable: true,
    type: ReevaluationSummaryDto,
    description: 'La última pasada terminada, o `null` si este proceso no ha corrido ninguna.',
  })
  ultima!: ReevaluationSummaryDto | null;
}

/** `POST /unresolved/:id/resolve`: qué pasó con el pendiente. */
export class ResolveUnresolvedResultDto {
  @ApiProperty({ example: '4821' }) id!: string;

  @ApiProperty({ example: 'RESOLVED', enum: ['RESOLVED', 'IGNORED', 'REJECTED', 'PENDING'] })
  status!: string;

  @ApiProperty({ required: false, nullable: true, example: 'GASTOS.EDUCACION' })
  categoryCode?: string | null;

  @ApiProperty({
    required: false,
    example: true,
    description:
      'El pendiente ya estaba resuelto y esta llamada no cambió nada. Resolver dos veces es idempotente a propósito: dos administradores pueden pulsar a la vez.',
  })
  alreadyResolved?: boolean;
}
