import { ApiProperty } from '@nestjs/swagger';

export class OperationArgumentDto {
  @ApiProperty({ example: 'a' })
  name!: string;

  @ApiProperty({
    type: [String],
    example: ['INTEGER', 'DECIMAL'],
    description: 'Tipos admitidos. Vacío significa que acepta cualquier tipo.',
  })
  types!: string[];

  @ApiProperty({ example: true })
  required!: boolean;

  @ApiProperty({ example: 'Primer sumando' })
  description!: string;
}

export class OperationDefinitionDto {
  @ApiProperty({ example: 'ADD' })
  id!: string;

  @ApiProperty({ example: 'Sumar' })
  label!: string;

  @ApiProperty({ example: 'MATH' })
  category!: string;

  @ApiProperty({ example: 'Suma dos o más números' })
  description!: string;

  @ApiProperty({ type: [OperationArgumentDto] })
  args!: OperationArgumentDto[];

  @ApiProperty({ example: 'DECIMAL', description: 'Tipo del valor devuelto.' })
  returns!: string;

  @ApiProperty({
    required: false,
    example: true,
    description: 'Aridad variable: admite N argumentos (SUM, MIN, MAX).',
  })
  variadic?: boolean;

  @ApiProperty({ example: 'ADD(1200, 300) = 1500' })
  example!: string;
}

/**
 * Catálogo del constructor visual.
 *
 * Es **cerrado** por diseño: el panel solo puede componer lo que aparece aquí. Se publica con
 * el máximo de líneas ejecutables porque es la misma cota que el guardián de código aplica al
 * guardar, y conocerla antes evita que un autor escriba algo que será rechazado.
 */
export class OperationCatalogDto {
  @ApiProperty({ type: [String], example: ['MATH', 'TEXT', 'DATE', 'LOGIC'] })
  categories!: string[];

  @ApiProperty({ type: [OperationDefinitionDto] })
  operations!: OperationDefinitionDto[];

  @ApiProperty({ example: 3, description: 'Máximo de líneas ejecutables de un campo calculado.' })
  maxExecutableLines!: number;
}
