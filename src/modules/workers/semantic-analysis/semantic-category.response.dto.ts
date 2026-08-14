/**
 * Forma de lo que devuelven los endpoints del catálogo semántico, en el contrato OpenAPI.
 *
 * No es documentación de adorno: `check-openapi-quality.mjs` falla si una operación no
 * declara el cuerpo de su respuesta, y con razón. Quien integra contra este catálogo
 * —el portal, una suite, otro equipo— sólo tiene el contrato para saber qué recibe; una
 * operación sin esquema obliga a leerse el servicio o a probar a ciegas contra un entorno.
 */
import { ApiProperty } from '@nestjs/swagger';

export class SemanticCategoryDto {
  @ApiProperty({ example: 'GASTOS.EDUCACION' }) code!: string;

  @ApiProperty({ example: 'Educación' }) name!: string;

  @ApiProperty({ example: 'Colegios, universidades y cursos de formación.' })
  description!: string;

  @ApiProperty({
    required: false,
    nullable: true,
    example: 'GASTOS',
    description: 'Categoría padre. `null` en las raíces del árbol.',
  })
  parentCode!: string | null;

  @ApiProperty({ type: [String], example: ['matricula universidad', 'pago colegio'] })
  positiveExamples!: string[];

  @ApiProperty({
    type: [String],
    example: ['libreria'],
    description: 'Textos que NO son de esta categoría aunque se le parezcan.',
  })
  counterExamples!: string[];

  @ApiProperty({ type: [String], example: ['no incluye material escolar'] })
  restrictions!: string[];

  @ApiProperty({ type: [String], example: ['GASTOS.LIBROS'] })
  relatedCategoryCodes!: string[];

  @ApiProperty({
    example: 0.72,
    description: 'Confianza mínima para asignar esta categoría sin pasar por la bandeja.',
  })
  acceptanceThreshold!: number;

  @ApiProperty({ example: 3, description: 'Sube en cada escritura de la categoría.' })
  version!: number;

  @ApiProperty({
    example: true,
    description: 'Una categoría no se borra: se desactiva, porque las trazas la citan.',
  })
  isActive!: boolean;
}

/** `SemanticCategoryService.importTree`: qué hizo la inyección de un subárbol. */
export class SemanticCategoryImportSummaryDto {
  @ApiProperty({ example: 12, description: 'Categorías que traía el lote.' })
  total!: number;

  @ApiProperty({ type: [String], example: ['GASTOS.EDUCACION'] })
  created!: string[];

  @ApiProperty({ type: [String], example: ['GASTOS'] })
  updated!: string[];

  @ApiProperty({
    example: false,
    description: 'Con `true` no se escribió nada: el resumen describe lo que HABRÍA pasado.',
  })
  dryRun!: boolean;
}
