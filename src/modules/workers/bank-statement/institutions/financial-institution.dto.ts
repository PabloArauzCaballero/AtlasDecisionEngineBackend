import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Los mismos valores que el enum de Prisma, escritos aquí para que el contrato
 * de entrada no dependa del cliente generado: un cambio del esquema que añada
 * un tipo debe ser una decisión, no una consecuencia.
 */
export const INSTITUTION_KINDS = [
  'MULTIPLE_BANK',
  'PYME_BANK',
  'STATE_BANK',
  'DEVELOPMENT_BANK',
  'HOUSING_ENTITY',
  'COOPERATIVE',
  'DEVELOPMENT_IFD',
] as const;

export const LICENSE_STATUSES = ['LICENSED', 'SUSPENDED', 'REVOKED'] as const;

/** Tope de patrones por entidad. Ver `MAX_PATTERN_LENGTH` en el servicio. */
const MAX_PATTERNS = 20;

export class UpsertFinancialInstitutionDto {
  @ApiProperty({
    description:
      'Sigla ASFI de la entidad. Es la clave con la que el regulador la nombra, y la que queda en la traza de cada documento atribuido.',
    example: 'BNB',
  })
  @IsString()
  @Length(2, 16)
  @Matches(/^[A-Z0-9_]+$/, {
    message:
      'El código es la sigla ASFI: sólo mayúsculas, dígitos y guion bajo. Sin espacios ni acentos, que harían que dos filas se lean iguales.',
  })
  code!: string;

  @ApiProperty({ description: 'Razón social como la publica ASFI.' })
  @IsString()
  @Length(3, 200)
  name!: string;

  @ApiProperty({ enum: INSTITUTION_KINDS })
  @IsEnum(INSTITUTION_KINDS)
  kind!: (typeof INSTITUTION_KINDS)[number];

  @ApiPropertyOptional({
    enum: LICENSE_STATUSES,
    description:
      'Situación de la licencia. Cualquier valor distinto de LICENSED exige `note`: quien revise el caso necesita leer por qué.',
  })
  @IsOptional()
  @IsEnum(LICENSE_STATUSES)
  licenseStatus?: (typeof LICENSE_STATUSES)[number];

  @ApiPropertyOptional({
    description:
      'Si capta depósitos del público y por tanto emite extractos de cuenta. Informativo: no rechaza documentos.',
  })
  @IsOptional()
  @IsBoolean()
  retailDeposits?: boolean;

  @ApiProperty({
    description:
      'Expresiones regulares que, impresas en la carátula, atribuyen el documento a esta entidad. Se evalúan sin distinguir mayúsculas.',
    example: ['BANCO\\s+NACIONAL\\s+DE\\s+BOLIVIA', '\\bBNB\\b'],
  })
  @IsArray()
  @ArrayMinSize(1, {
    message:
      'Una entidad sin marcadores no atribuye ningún documento: quedaría en el padrón sin poder reconocer nada.',
  })
  @ArrayMaxSize(MAX_PATTERNS)
  @IsString({ each: true })
  markers!: string[];

  @ApiPropertyOptional({
    description:
      'Expresiones que ANULAN la atribución aunque un marcador coincida. Es lo que separa a un banco de su aseguradora hermana.',
    example: ['BISA\\s+SEGUROS'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PATTERNS)
  @IsString({ each: true })
  exclusions?: string[];

  @ApiPropertyOptional({
    description: 'Por qué la licencia no está vigente. Obligatorio si no lo está.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  note?: string;
}
