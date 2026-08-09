import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DATABASE_ID_PATTERN } from '../../common/http/id';

export const OUTCOME_LABELS = [
  'GOOD',
  'BAD',
  'REJECTED_WOULD_HAVE_BEEN_GOOD',
  'REJECTED_CONFIRMED_BAD',
  'INDETERMINATE',
] as const;

export class RecordOutcomeDto {
  @ApiProperty({ example: '88001' })
  @Matches(DATABASE_ID_PATTERN)
  executionId!: string;

  @ApiProperty({
    example: 90,
    description: 'Días desde la decisión. Forma parte de la identidad de la observación.',
  })
  @IsInt()
  @Min(1)
  windowDays!: number;

  @ApiProperty({ enum: OUTCOME_LABELS })
  @IsIn([...OUTCOME_LABELS])
  label!: (typeof OUTCOME_LABELS)[number];

  @ApiPropertyOptional({ example: 12500.5, description: 'Importe perdido o días de mora.' })
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiProperty({ example: 'COLLECTIONS_SYSTEM' })
  @IsString()
  @MaxLength(120)
  source!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  notes?: string;
}

/** Carga en lote: el sistema de cobranza cierra miles de casos a la vez, no de uno en uno. */
export class RecordOutcomeBatchDto {
  @ApiProperty({ type: [RecordOutcomeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecordOutcomeDto)
  observations!: RecordOutcomeDto[];
}

export class RecordMonitoringAttributeDto {
  @ApiProperty({ example: '88001' })
  @Matches(DATABASE_ID_PATTERN)
  executionId!: string;

  @ApiProperty({ example: 'AGE_BAND', description: 'Grupo bajo examen. Lo define quien audita.' })
  @IsString()
  @MaxLength(80)
  attribute!: string;

  @ApiProperty({
    example: '60+',
    description: 'Valor YA AGRUPADO. Bandas, no valores exactos: para medir sesgo basta el grupo.',
  })
  @IsString()
  @MaxLength(80)
  groupValue!: string;
}

export class RecordMonitoringAttributeBatchDto {
  @ApiProperty({ type: [RecordMonitoringAttributeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecordMonitoringAttributeDto)
  attributes!: RecordMonitoringAttributeDto[];
}

/** Ventana temporal común a los tres análisis. */
export class MonitoringWindowQueryDto {
  @ApiProperty({ example: '4001' })
  @Matches(DATABASE_ID_PATTERN)
  artifactVersionId!: string;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: '2026-06-30T23:59:59.000Z' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class StabilityQueryDto extends MonitoringWindowQueryDto {
  @ApiProperty({
    example: 'ingresos_mensuales',
    description: 'Variable de entrada cuya distribución se compara entre las dos ventanas.',
  })
  @IsString()
  @MaxLength(120)
  variableCode!: string;

  @ApiProperty({
    example: '2025-07-01T00:00:00.000Z',
    description: 'Inicio de la ventana de REFERENCIA, contra la que se compara la actual.',
  })
  @IsISO8601()
  referenceFrom!: string;

  @ApiProperty({ example: '2025-12-31T23:59:59.000Z' })
  @IsISO8601()
  referenceTo!: string;
}

export class AdverseImpactQueryDto extends MonitoringWindowQueryDto {
  @ApiProperty({ example: 'AGE_BAND' })
  @IsString()
  @MaxLength(80)
  attribute!: string;
}
