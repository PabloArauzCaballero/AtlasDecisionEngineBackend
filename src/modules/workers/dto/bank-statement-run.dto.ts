import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Alta de una conversión de extracto.
 *
 * El archivo viaja como `multipart/form-data`, así que aquí sólo van los campos
 * de texto que lo acompañan.
 */
export class CreateBankStatementRunDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  @ApiPropertyOptional({
    description: 'Escenario de prueba. Excluyente con el archivo subido.',
  })
  fixtureCode?: string;

  /*
   * El titular que se exige: el nombre legal del cliente que sube el extracto (lo manda AtlasBackend). Sin
   * él no se exige titular y sólo se informa el leído (la Consola del portal, llamadas antiguas).
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @ApiPropertyOptional({
    description:
      'Nombre completo del titular exigido (el cliente que sube el extracto). Si llega, el extracto se rechaza cuando ningún titular coincide y va a revisión si el titular no se puede leer.',
  })
  expectedHolderName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @ApiPropertyOptional({
    description: 'Nombres de pila del titular exigido. Afina la comparación.',
  })
  expectedHolderGivenNames?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @ApiPropertyOptional({ description: 'Apellidos del titular exigido. Afina la comparación.' })
  expectedHolderSurnames?: string;
}

/** Formatos de descarga del resultado del worker de extractos. */
export const STATEMENT_DOWNLOAD_FORMATS = ['csv', 'json', 'normalized'] as const;
export type StatementDownloadFormat = (typeof STATEMENT_DOWNLOAD_FORMATS)[number];

export class StatementDownloadQueryDto {
  @IsIn(STATEMENT_DOWNLOAD_FORMATS)
  @ApiProperty({
    enum: STATEMENT_DOWNLOAD_FORMATS,
    default: 'csv',
    description:
      'Formato del archivo. `csv`: los movimientos en tabla, con BOM para que Excel respete las tildes. `json`: solo los movimientos. `normalized`: el contrato normalizado completo, con la cuenta y los metadatos del extracto. En los tres casos la cuenta va enmascarada.',
  })
  format: StatementDownloadFormat = 'csv';
}
