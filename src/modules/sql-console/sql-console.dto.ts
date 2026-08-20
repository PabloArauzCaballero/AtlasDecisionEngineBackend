import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MAX_SQL_BYTES } from './guard/sql-guard';

/**
 * La consulta viaja en el CUERPO, siempre, incluso para validar.
 *
 * En la cadena de consulta acabaría en el registro de acceso, en el proxy y en la traza
 * distribuida —tres sitios pensados para conservarse—, y una consulta de análisis lleva
 * dentro exactamente lo que se estaba buscando: fechas, segmentos, a veces un identificador.
 * Es el mismo criterio que aplica `data-subject.dto.ts` a la referencia del titular.
 *
 * Por eso `POST /validate` es un POST aunque no cambie nada: el verbo aquí lo decide dónde
 * puede viajar el dato, no si la operación es idempotente.
 */
export class RunQueryDto {
  @ApiProperty({
    description: 'La consulta SQL. Sólo SELECT o WITH, una sola sentencia.',
    example: 'SELECT estado, count(*) FROM decisiones.ejecuciones WHERE es_produccion GROUP BY 1',
    maxLength: MAX_SQL_BYTES,
  })
  @IsString()
  @MinLength(1)
  // El tope real lo impone la guardia contando BYTES; éste acota la longitud en caracteres
  // para que una entrada absurda muera en el validador y no dentro del analizador léxico.
  @MaxLength(MAX_SQL_BYTES)
  statement!: string;
}

export class QueryHistoryDto {
  @ApiPropertyOptional({
    description: 'Cuántas consultas recientes devolver.',
    minimum: 1,
    maximum: 100,
    default: 25,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
