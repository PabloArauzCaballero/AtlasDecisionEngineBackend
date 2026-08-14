import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DATABASE_ID_PATTERN } from '../../common/http/id';
import { OUTCOME_LABELS } from '../model-monitoring/model-monitoring.dto';

/** Un crédito tal como lo reporta el sistema de cartera. */
export class RegisterFacilityDto {
  @ApiProperty({
    example: 'LOAN-2026-000841',
    description: 'Identificador en el core. Es la costura por la que entra el desenlace.',
  })
  @IsString()
  @MaxLength(160)
  externalReference!: string;

  @ApiProperty({
    example: '88001',
    description:
      'La decisión que lo originó. De ella se toma el solicitante, así que una ejecución sin ' +
      'sujeto no puede originar un crédito: no habría a quién atribuírselo.',
  })
  @Matches(DATABASE_ID_PATTERN)
  originationExecutionId!: string;

  @ApiProperty({ example: 1500 })
  @IsNumber()
  @IsPositive()
  principalAmount!: number;

  @ApiProperty({ example: 'BOB' })
  @IsString()
  @MaxLength(3)
  currencyCode!: string;

  @ApiProperty({ example: 12 })
  @IsInt()
  @Min(1)
  termMonths!: number;

  @ApiProperty({ example: 0.28, description: 'Tasa anual en tanto por uno, no en porcentaje.' })
  @IsNumber()
  annualRate!: number;

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  disbursedAt?: string;
}

export class RegisterFacilityBatchDto {
  @ApiProperty({ type: [RegisterFacilityDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegisterFacilityDto)
  facilities!: RegisterFacilityDto[];
}

/**
 * Un desenlace identificado por el CRÉDITO, no por la ejecución.
 *
 * El sistema de cobranza conoce préstamos; no conoce ni tiene por qué conocer el identificador
 * interno de la ejecución que los aprobó. Obligarle a traducir era pedirle que mantuviera un
 * mapa que ya vive aquí, y ese mapa desactualizado habría sido la primera fuente de desenlaces
 * atribuidos al crédito equivocado.
 */
export class FacilityOutcomeDto {
  @ApiProperty({ example: 'LOAN-2026-000841' })
  @IsString()
  @MaxLength(160)
  externalReference!: string;

  @ApiProperty({ example: 90 })
  @IsInt()
  @Min(1)
  windowDays!: number;

  @ApiProperty({ enum: OUTCOME_LABELS })
  @IsIn([...OUTCOME_LABELS])
  label!: (typeof OUTCOME_LABELS)[number];

  @ApiPropertyOptional({ example: 320.5 })
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiProperty({ example: 'COLLECTIONS_SYSTEM' })
  @IsString()
  @MaxLength(120)
  source!: string;

  @ApiPropertyOptional({
    example: 'BUREAU_LOOKUP',
    description:
      'Cómo se supo, si NO se observó directamente. Vacío = observado. Un inferido mezclado ' +
      'con los observados calibra el modelo contra la población que ya aprobó.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  inferenceMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  notes?: string;
}

export class FacilityOutcomeBatchDto {
  @ApiProperty({ type: [FacilityOutcomeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FacilityOutcomeDto)
  outcomes!: FacilityOutcomeDto[];

  @ApiPropertyOptional({
    example: true,
    description:
      'Valida y NO escribe nada. Existe porque una carga de cobranza trae miles de filas y ' +
      'descubrir en la fila 4000 que la referencia no existía, con 3999 ya escritas, obliga a ' +
      'un borrado manual sobre evidencia regulatoria.',
  })
  @IsOptional()
  dryRun?: boolean;
}

/** Ventana de la matriz de cosechas. */
export class VintageQueryDto {
  @ApiPropertyOptional({ example: '4001' })
  @IsOptional()
  @Matches(DATABASE_ID_PATTERN)
  artifactVersionId?: string;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.000Z' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class PendingWindowsQueryDto {
  @ApiPropertyOptional({ example: 50, description: 'Máximo 200: es una cola de trabajo, no un volcado.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
