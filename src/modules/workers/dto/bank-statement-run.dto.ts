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
