import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
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
} from 'class-validator';
import { DATABASE_ID_PATTERN } from '../../common/http/id';

export const LEGAL_BASES = [
  'CONSENT',
  'CONTRACT',
  'LEGAL_OBLIGATION',
  'CREDIT_PROTECTION',
  'LEGITIMATE_INTEREST',
  'VITAL_INTEREST',
  'HEALTH_PROTECTION',
] as const;

/** Un límite de cartera. El motor lo comprueba al decidir; el grafo ya no tiene que acordarse. */
export class UpsertExposureLimitDto {
  @ApiProperty({ example: 'SUBJECT_TOTAL' })
  @IsString()
  @MaxLength(60)
  limitCode!: string;

  @ApiPropertyOptional({ example: 'MICROCREDITO_URBANO', description: 'Vacío = toda la cartera.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  segment?: string;

  @ApiProperty({ example: 12000 })
  @IsNumber()
  @IsPositive()
  maxValue!: number;

  @ApiProperty({ example: 'BOB' })
  @IsString()
  @MaxLength(3)
  currencyCode!: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'Falso mide y avisa sin rechazar. Es la forma de estrenar un límite sin parar la ' +
      'originación el primer día.',
  })
  @IsOptional()
  @IsBoolean()
  enforced?: boolean;
}

/** Un hecho del estado de la cartera, tal como lo reporta el sistema de gestión. */
export class RecordPortfolioStateDto {
  @ApiProperty({ example: '2026-08-12T00:00:00.000Z' })
  @IsISO8601()
  asOf!: string;

  @ApiProperty({ example: 'TOTAL_EXPOSURE' })
  @IsString()
  @MaxLength(60)
  metricCode!: string;

  @ApiPropertyOptional({ example: 'MICROCREDITO_URBANO' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  segment?: string;

  @ApiProperty({ example: 4820000.5 })
  @IsNumber()
  value!: number;
}

/** Permiso de un titular para una finalidad concreta, con su vigencia. */
export class RecordConsentDto {
  @ApiProperty({
    example: 'ABC-99182',
    description: 'La misma referencia con la que se ejecutaron sus decisiones. Se guarda en HMAC.',
  })
  @IsString()
  @MaxLength(200)
  subjectReference!: string;

  @ApiProperty({ example: 'BANK_STATEMENT_ANALYSIS' })
  @IsString()
  @MaxLength(120)
  purpose!: string;

  @ApiProperty({ enum: LEGAL_BASES })
  @IsIn([...LEGAL_BASES])
  basis!: (typeof LEGAL_BASES)[number];

  @ApiProperty({ example: '2026-01-15T00:00:00.000Z' })
  @IsISO8601()
  grantedAt!: string;

  @ApiPropertyOptional({
    example: '2027-01-15T00:00:00.000Z',
    description: 'Vacío = sin caducidad declarada. No es lo mismo que «para siempre».',
  })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @ApiPropertyOptional({ example: 'EXP-2026-0091', description: 'Dónde está la prueba. Nunca el dato.' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  evidenceRef?: string;
}

export class RevokeConsentDto {
  @ApiProperty({ example: 'ABC-99182' })
  @IsString()
  @MaxLength(200)
  subjectReference!: string;

  @ApiProperty({ example: 'BANK_STATEMENT_ANALYSIS' })
  @IsString()
  @MaxLength(120)
  purpose!: string;
}

/** Petición de reidentificación: ir del caso seudónimo a la persona. */
export class RequestReidentificationDto {
  @ApiProperty({ example: 'ABC-99182' })
  @IsString()
  @MaxLength(200)
  subjectReference!: string;

  @ApiProperty({
    example: 'Reclamo 4471 en defensa del consumidor: hay que contactar al titular.',
    description: 'En prosa. Es lo que otra persona va a leer para aprobar o negar.',
  })
  @IsString()
  @MaxLength(2_000)
  purpose!: string;
}

export class DecideReidentificationDto {
  @ApiProperty({ example: '31' })
  @Matches(DATABASE_ID_PATTERN)
  requestId!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  approve!: boolean;
}

/** Ventana y plazo sobre los que se calibra una versión. */
export class CalibrationRequestDto {
  @ApiProperty({ example: '4001' })
  @Matches(DATABASE_ID_PATTERN)
  artifactVersionId!: string;

  @ApiProperty({ example: 90, description: 'Plazo de la observación. A 30 y a 360 no son la misma curva.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  windowDays!: number;

  @ApiProperty({
    example: 'pd',
    description: 'Campo de salida con rol PROBABILITY_OF_DEFAULT del que se lee la predicción.',
  })
  @IsString()
  @MaxLength(120)
  predictionField!: string;
}

/** Expediente del modelo: quién validó una versión, con qué límites y cuándo revalidar. */
export class RecordModelDossierDto {
  @ApiProperty({ example: '4001' })
  @Matches(DATABASE_ID_PATTERN)
  artifactVersionId!: string;

  @ApiProperty({ example: 'validacion.independiente@atlas' })
  @IsString()
  @MaxLength(160)
  validatedBy!: string;

  @ApiProperty({ example: '2026-08-12T00:00:00.000Z' })
  @IsISO8601()
  validatedAt!: string;

  @ApiProperty({
    example: '2027-08-12T00:00:00.000Z',
    description: 'Vencido no bloquea la ejecución, pero se marca y no se puede ignorar.',
  })
  @IsISO8601()
  revalidationDueAt!: string;

  @ApiPropertyOptional({
    example: 'No validado para solicitantes sin historial bancario de 6 meses.',
    description: 'Población para la que NO sirve, supuestos y datos que no vio.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  limitationsNotes?: string;
}
