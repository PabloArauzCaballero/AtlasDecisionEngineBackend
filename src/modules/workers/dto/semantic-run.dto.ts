import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Alta de una ejecución de análisis semántico.
 *
 * O `text` o `fixtureCode`, nunca los dos: aceptar ambos obligaría a decidir
 * cuál gana, y esa decisión siempre sorprende a alguien. La exclusión se valida
 * en el servicio, donde se puede dar un mensaje que explique la regla.
 */
export class CreateSemanticAnalysisRunDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100_000)
  @ApiPropertyOptional({ description: 'Texto a analizar. Excluyente con `fixtureCode`.' })
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @ApiPropertyOptional({ description: 'Escenario de prueba. Excluyente con `text`.' })
  fixtureCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @ApiPropertyOptional({
    description:
      'Clave de deduplicación. Si se omite se deriva del contenido, de modo que reenviar el mismo texto no crea una segunda ejecución.',
  })
  idempotencyKey?: string;
}

/** Un texto dentro de un alta por lote. Sin escenarios: un lote es trabajo real. */
export class SemanticBatchItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100_000)
  @ApiProperty({ description: 'Texto a analizar.' })
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @ApiPropertyOptional({
    description: 'Clave de deduplicación de este texto. Ver `CreateSemanticAnalysisRunDto`.',
  })
  idempotencyKey?: string;
}

/**
 * Alta de varios análisis semánticos en una sola petición.
 *
 * ## Por qué existe
 *
 * Clasificar un extracto es clasificar sus glosas distintas —del orden de cien—
 * y el alta de una en una convertía ese trabajo en cien peticiones más los
 * sondeos de cada una. El portal tenía que defenderse de su propio tráfico:
 * cuatro en vuelo como máximo, para no agotar el limitador de tasa y empezar a
 * recibir 429 que la tabla enseñaba como fallos de clasificación. El resultado
 * era una espera de minutos gobernada por el ritmo del sondeo, no por lo que
 * tarda el motor en clasificar.
 *
 * Con el lote, esas cien altas son UNA petición y un `INSERT` masivo. El trabajo
 * del worker no cambia —sigue siendo una ejecución auditable por glosa, con su
 * fila, su estado y su resultado—; lo que desaparece es el peaje de red y de
 * limitador que se pagaba por cada una.
 *
 * ## El tope
 *
 * Doscientas por lote. Es un `INSERT` dentro de una transacción y un cuerpo de
 * unos pocos kilobytes; por encima, lo honesto es que el cliente parta el
 * trabajo y no que el servidor decida en silencio cuánto atiende.
 */
export class CreateSemanticAnalysisBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SemanticBatchItemDto)
  @ApiProperty({ type: [SemanticBatchItemDto], description: 'Textos a analizar.' })
  items!: SemanticBatchItemDto[];
}

/**
 * Consulta del estado de varias ejecuciones a la vez.
 *
 * Va por `POST` y no por `GET` con parámetros por una razón mecánica: doscientos
 * identificadores son unos siete kilobytes de URL, muy por encima de lo que
 * cualquier proxy acepta. No modifica nada.
 */
export class WorkerRunStatusQueryDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  @ApiProperty({ type: [String], description: 'Identificadores de las ejecuciones a consultar.' })
  requestIds!: string[];
}
