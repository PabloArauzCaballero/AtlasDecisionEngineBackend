/** El expediente del alta que AtlasBackend adjunta al caso de revisión de una ejecución. */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ManualReviewWriteResultDto } from './manual-review.response.dto';

/** Cómo abrir el caso cuando la ejecución no terminó en revisión humana. */
export class OpenIfMissingDto {
  @ApiPropertyOptional({
    description: 'Cola del caso. Por defecto `IDENTIDAD`, que es la que vuelve a AtlasBackend.',
    example: 'IDENTIDAD',
    minLength: 1,
    maxLength: 80,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  queueCode?: string;

  @ApiPropertyOptional({
    description: 'Prioridad (menor = antes). Por defecto 50, la del artefacto de identidad.',
    example: 50,
    minimum: 0,
    maximum: 10_000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  priority?: number;

  @ApiPropertyOptional({
    description: 'Plazo del caso en minutos. Por defecto 240, el SLA de la cola IDENTIDAD.',
    example: 240,
    minimum: 1,
    maximum: 43_200,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(43_200)
  slaMinutes?: number;

  @ApiPropertyOptional({
    description: 'Por qué se abre. Por defecto `REVISION_HUMANA_OBLIGATORIA`.',
    example: 'REVISION_HUMANA_OBLIGATORIA',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  motivo?: string;
}

export class AttachOnboardingDossierDto {
  @ApiProperty({
    description:
      'Expediente del alta (JSON libre, hasta 256 KB serializado). Se guarda en ' +
      '`evidenceJson.alta` del caso, reemplazando el anterior.',
    type: 'object',
    additionalProperties: true,
    example: { version: 1, generadoEn: '2026-09-28T12:00:00.000Z' },
  })
  @IsObject()
  dossier!: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Si la ejecución no tiene caso, ábrelo con estos datos. Sin él, una ejecución sin caso es 404.',
    type: OpenIfMissingDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => OpenIfMissingDto)
  openIfMissing?: OpenIfMissingDto;
}

export class OnboardingDossierResultDto extends ManualReviewWriteResultDto {
  @ApiProperty({
    description: '`true` si esta llamada abrió el caso; `false` si ya existía y sólo se adjuntó.',
    example: false,
  })
  created!: boolean;
}
