import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Superficie de administración del árbol de categorías del worker semántico.
 *
 * Hasta ahora el catálogo sólo se podía cambiar sembrando y reiniciando el
 * motor, y eso convertía cada hueco descubierto —una glosa que ningún banco
 * escribe como el catálogo esperaba— en un despliegue. Estos DTO existen para
 * que se pueda corregir en caliente y para que la corrección quede auditada.
 *
 * Las restricciones repiten las del sembrador a propósito: un catálogo escrito
 * por la API y otro escrito por la semilla tienen que poder convivir en la misma
 * tabla sin que el clasificador note de cuál vino cada fila.
 */

const CODIGO = /^[A-Z][A-Z0-9]*(?:\.[A-Z][A-Z0-9_]*)*$/;

export class UpsertSemanticCategoryDto {
  @Matches(CODIGO, {
    message:
      'El código va en mayúsculas y separa niveles con puntos, como GASTOS.VIVIENDA.ALQUILER.',
  })
  @MaxLength(120)
  @ApiProperty({ example: 'GASTOS.VIVIENDA.ALQUILER' })
  code!: string;

  @IsString() @MinLength(1) @MaxLength(200) @ApiProperty({ example: 'Alquiler' }) name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2_000)
  @ApiProperty({ example: 'Pago periódico por el uso de una vivienda que no es propia.' })
  description!: string;

  /**
   * `null` en las raíces. Se envía explícito y no se omite: omitirlo al
   * actualizar significaría «no lo cambies», y colgar una rama de la raíz por
   * accidente reordena el árbol entero.
   */
  @IsOptional()
  @Matches(CODIGO)
  @MaxLength(120)
  @ApiPropertyOptional({ example: 'GASTOS.VIVIENDA', nullable: true })
  parentCode?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  @ArrayMaxSize(60)
  @ApiPropertyOptional({ example: ['PAGO ALQUILER DEPARTAMENTO'] })
  positiveExamples?: string[];

  /**
   * Pesan tanto como los positivos: son los que impiden que «pago cuota préstamo
   * vivienda» caiga en Alquiler. El clasificador los mide de verdad.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  @ArrayMaxSize(60)
  @ApiPropertyOptional({ example: ['PAGO CUOTA PRESTAMO HIPOTECARIO'] })
  counterExamples?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  @ArrayMaxSize(20)
  @ApiPropertyOptional()
  restrictions?: string[];

  @IsOptional()
  @IsArray()
  @Matches(CODIGO, { each: true })
  @ArrayMaxSize(20)
  @ApiPropertyOptional()
  relatedCategoryCodes?: string[];

  /**
   * Umbral de aceptación. `1` deja la categoría inalcanzable a propósito: es lo
   * que se pone en las ramas, que agrupan y no clasifican.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @ApiPropertyOptional({ example: 0.62 })
  acceptanceThreshold?: number;

  @IsOptional() @IsBoolean() @ApiPropertyOptional({ example: true }) isActive?: boolean;

  /**
   * Sube la versión de la categoría cuando cambia su SIGNIFICADO.
   *
   * No es decorativo: la clave del vector guardado incluye la versión, así que
   * subirla es lo que invalida el embedding calculado con los ejemplos viejos.
   * Se deja en manos de quien edita porque sólo esa persona sabe si corrigió una
   * errata o cambió lo que la categoría quiere decir.
   */
  @IsOptional() @IsInt() @Min(1) @ApiPropertyOptional({ example: 2 }) version?: number;
}

/**
 * Inyección de un subárbol entero en una sola petición.
 *
 * Es la forma en que un catálogo se corrige de verdad: quien descubre que su
 * banco escribe `TRASPASO CA/CC CON QR (MOVIL)` no quiere crear ocho categorías
 * a mano, quiere pegar el JSON que ya tiene. Se resuelve en UNA transacción y
 * ordenado por profundidad, de modo que un padre nunca llegue después que su
 * hijo y que un fallo a mitad no deje medio árbol escrito.
 */
export class ImportSemanticCategoriesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => UpsertSemanticCategoryDto)
  @ApiProperty({ type: [UpsertSemanticCategoryDto] })
  categories!: UpsertSemanticCategoryDto[];

  /**
   * Comprueba y responde qué haría, sin escribir nada.
   *
   * Un catálogo es la memoria del clasificador: pegar quinientas filas sin poder
   * mirar antes qué se va a crear y qué se va a pisar es la clase de operación
   * que sólo se hace una vez.
   */
  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({ description: 'Valida y explica el resultado sin escribir.' })
  dryRun?: boolean;
}
