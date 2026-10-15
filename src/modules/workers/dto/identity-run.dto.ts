import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Alta de una verificación de identidad.
 *
 * Las dos imágenes viajan como `multipart/form-data`, así que aquí sólo van los
 * campos de texto que las acompañan.
 */
export class CreateIdentityVerificationRunDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @ApiPropertyOptional({
    description: 'Escenario de prueba. Excluyente con las imágenes subidas.',
  })
  fixtureCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/, { message: 'documentCountry debe ser un código ISO 3166-1 alfa-2.' })
  @ApiPropertyOptional({
    description:
      'País emisor del documento, ISO 3166-1 alfa-2. Decide qué analizador se usa; si se omite se toma el del despliegue.',
    example: 'BO',
  })
  documentCountry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @ApiPropertyOptional({
    description:
      'Clave de deduplicación. Sin ella se deriva del contenido de las imágenes, de modo que reenviar las mismas fotos no crea una segunda verificación.',
  })
  idempotencyKey?: string;
}
