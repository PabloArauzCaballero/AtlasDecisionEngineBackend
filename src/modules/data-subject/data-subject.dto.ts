import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const DATA_SUBJECT_REQUEST_TYPES = ['ACCESS', 'PORTABILITY', 'ERASURE', 'REVIEW'] as const;

/**
 * La referencia del titular viaja en el CUERPO, nunca en la ruta ni en la cadena de consulta.
 *
 * Un documento de identidad en una URL acaba en el registro de acceso, en el historial del
 * proxy y en la traza distribuida, tres sitios pensados para conservarse y consultarse. Es la
 * misma razón por la que el filtro de excepciones redacta el query string.
 */
export class CreateDataSubjectRequestDto {
  @ApiProperty({
    description:
      'La misma referencia con la que se ejecutaron las decisiones (`subjectReference`). Se ' +
      'convierte a HMAC antes de tocar la base: en claro no se persiste nunca.',
    example: 'CPF-12345678901',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subjectReference!: string;

  @ApiProperty({ enum: DATA_SUBJECT_REQUEST_TYPES })
  @IsIn([...DATA_SUBJECT_REQUEST_TYPES])
  requestType!: (typeof DATA_SUBJECT_REQUEST_TYPES)[number];

  @ApiPropertyOptional({
    description: 'Expediente o ticket del canal de atención. Nunca un dato del titular.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;
}
