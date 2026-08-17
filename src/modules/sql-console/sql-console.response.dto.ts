import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class CatalogColumnDto {
  @ApiProperty({ example: 'estado' }) name!: string;
  @ApiProperty({ example: 'texto' }) kind!: string;
  @ApiProperty({ example: 'APPROVED, REJECTED, MANUAL_REVIEW, ERROR…' }) description!: string;
}

class CatalogTableDto {
  @ApiProperty({ example: 'ejecuciones' }) name!: string;
  @ApiProperty() description!: string;
  @ApiProperty({
    // `type` explícito: de `string | null` Swagger infiere `object`, y entonces el
    // ejemplo contradice el esquema que él mismo publicó. Lo detecta `redocly lint`.
    type: String,
    example: 'Una fila = una decisión ejecutada por el motor.',
    nullable: true,
    description:
      'Qué es UNA fila. Va en el catálogo y no en la documentación porque sin esta frase ' +
      'un COUNT(*) se interpreta mal, y nadie consulta la documentación antes de contar. ' +
      'Es null en una vista que la base publica y que nadie ha fichado todavía: un grano ' +
      'derivado del nombre se leería igual que uno comprobado.',
  })
  grain!: string | null;
  @ApiProperty({ type: [CatalogColumnDto] }) columns!: CatalogColumnDto[];
}

/**
 * Una relación que la base publica y la consola NO sirve.
 *
 * Se publica en la misma respuesta que el catálogo a propósito. Sin esto, una vista gobernada
 * a la que le falte el filtro por inquilino es indistinguible de una que no existe, y la
 * pregunta «¿por qué no veo mi vista?» no tiene ninguna respuesta que dé el sistema.
 */
class OmittedRelationDto {
  @ApiProperty({ example: 'riesgo.exposicion' }) name!: string;
  @ApiProperty({
    example:
      'Su definición no invoca public.atlas_current_tenant(), así que no hay nada que acote ' +
      'las filas al inquilino que consulta.',
  })
  reason!: string;
}

class CatalogDatasetDto {
  @ApiProperty({ example: 'decisiones' }) name!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ type: [CatalogTableDto] }) tables!: CatalogTableDto[];
}

class ConsoleLimitsDto {
  @ApiProperty({ example: 10000 }) maxRows!: number;
  @ApiProperty({ example: 12000 }) timeoutMs!: number;
  @ApiProperty({ example: 65536 }) maxStatementBytes!: number;
}

export class SqlCatalogDto {
  @ApiProperty({ type: [CatalogDatasetDto] }) datasets!: CatalogDatasetDto[];
  @ApiProperty({ type: [OmittedRelationDto] }) omitted!: OmittedRelationDto[];
  @ApiProperty({ type: ConsoleLimitsDto }) limits!: ConsoleLimitsDto;
}

export class QueryViolationDto {
  @ApiProperty({ example: 'SQL_FORBIDDEN_KEYWORD' }) code!: string;
  @ApiProperty() message!: string;
  @ApiPropertyOptional({ example: 3 }) line?: number;
  @ApiPropertyOptional({ example: 12 }) column?: number;
}

export class QueryEstimateDto {
  @ApiProperty({
    example: 18420,
    description: 'Filas que el planificador ESPERA. Es una estimación, no una promesa.',
  })
  estimatedRows!: number;
  @ApiProperty({ example: 1473600 }) estimatedBytes!: number;
  @ApiProperty({ example: 1240.55 }) planCost!: number;
  @ApiProperty({
    type: [String],
    example: ['decisiones.ejecuciones'],
    description: 'Relaciones que el plan recorre de verdad, no las que el texto nombra.',
  })
  scannedRelations!: string[];
}

/**
 * Respuesta de `POST /validate`: el «dry run» de la consola.
 *
 * Devuelve las violaciones y la estimación por separado a propósito. Una consulta puede
 * ser válida y a la vez carísima, y son dos avisos distintos: el primero impide ejecutar,
 * el segundo sólo advierte. Colapsarlos en un booleano dejaría a quien escribe sin saber
 * si el problema es que la consulta está mal o que va a tardar.
 */
export class QueryValidationDto {
  @ApiProperty({ example: true }) valid!: boolean;
  @ApiProperty({ type: [QueryViolationDto] }) violations!: QueryViolationDto[];
  @ApiPropertyOptional({ type: QueryEstimateDto }) estimate?: QueryEstimateDto;
}

class ResultColumnDto {
  @ApiProperty({ example: 'estado' }) name!: string;
  @ApiProperty({
    example: 'texto',
    description:
      'Tipo con el que presentar la columna. Los enteros grandes y los decimales viajan ' +
      'como CADENA para no perder precisión; este campo es lo que permite alinearlos y ' +
      'formatearlos como números sin volver a convertirlos.',
  })
  kind!: string;
}

export class QueryResultDto {
  @ApiProperty({ type: [ResultColumnDto] }) columns!: ResultColumnDto[];
  @ApiProperty({
    description:
      'Filas como matriz, no como objetos: una consulta puede repetir el nombre de una columna.',
    // La celda es de cualquier tipo escalar, o nula: sin declararlo, Swagger
    // publicaba una matriz de cadenas y el ejemplo con números no validaba.
    // Una celda es cualquier escalar, o nula. `oneOf` y no un `type` suelto:
    // `nullable` exige tipo declarado, y la celda no tiene uno solo.
    type: 'array',
    items: {
      type: 'array',
      items: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
    },
    example: [['APPROVED', 18420]],
  })
  rows!: (string | number | boolean | null)[][];
  @ApiProperty({ example: 2 }) rowCount!: number;
  @ApiProperty({ example: 184 }) durationMs!: number;
  @ApiProperty({
    example: false,
    description: 'El resultado se cortó en el tope de filas y hay más del que se devuelve.',
  })
  truncated!: boolean;
  @ApiProperty({ type: QueryEstimateDto }) estimate!: QueryEstimateDto;
}

export class QueryHistoryEntryDto {
  @ApiProperty({ example: '3312' }) id!: string;
  @ApiProperty({ example: 'SELECT estado, count(*) FROM decisiones.ejecuciones GROUP BY 1' })
  statement!: string;
  @ApiProperty({ example: 'SUCCEEDED', enum: ['VALIDATED', 'SUCCEEDED', 'REJECTED', 'FAILED'] })
  outcome!: string;
  // Los tres son uniones con null: sin `type`, mismo defecto que arriba.
  @ApiPropertyOptional({ type: String, nullable: true, example: 'SQL_TIMEOUT' })
  errorCode?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true, example: 2 }) rowCount?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, example: 184 }) durationMs?: number | null;
  @ApiProperty({ example: false }) truncated!: boolean;
  @ApiProperty({ type: [String], example: ['decisiones.ejecuciones'] }) relations!: string[];
  @ApiProperty({ example: '2026-08-14T09:00:00.000Z' }) executedAt!: string;
}

export class QueryHistoryPageDto {
  @ApiProperty({ type: [QueryHistoryEntryDto] }) entries!: QueryHistoryEntryDto[];
}
