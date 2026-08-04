/**
 * Contratos HTTP de los dos workers adicionales (ADR-0026).
 *
 * Comparten archivo porque comparten el ciclo de vida —estado, progreso,
 * intentos, correlación— y el frontend pinta las dos vistas con el mismo
 * código. Lo que NO comparten (la entrada y el resultado) vive en clases
 * separadas: mezclarlo habría producido un DTO con la mitad de los campos
 * opcionales, que no valida nada.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkerInputSource, WorkerRunStatus } from '@prisma/client';
import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/http/pagination';

/** Escenario de prueba servido al frontend. */
export class WorkerFixtureDto {
  @ApiProperty({ example: 'valid-basic' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Qué demuestra este escenario.' }) description!: string;
  @ApiProperty({ description: 'Vista previa segura de la entrada.' }) preview!: string;
  @ApiProperty({
    description: 'Si se espera que el escenario termine en error controlado.',
  })
  expectsFailure!: boolean;
}

/** Disponibilidad y límites de un worker. Alimenta el encabezado de la vista. */
export class WorkerDescriptorDto {
  @ApiProperty({ example: 'semantic-analysis' }) code!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ description: 'Tipos de entrada que acepta.' }) acceptedInputs!: string[];
  @ApiProperty({ description: 'Restricciones publicadas al cliente.' })
  limits!: Record<string, number | string>;
  @ApiProperty({
    description:
      'Si el worker está habilitado en este despliegue. Un worker apagado acepta consultas pero no ejecuciones.',
  })
  available!: boolean;
  @ApiProperty({ description: 'Si los escenarios de prueba están habilitados.' })
  fixturesEnabled!: boolean;
}

/** Vista de una ejecución. Idéntica para los dos workers salvo el resultado. */
export class WorkerRunDto {
  @ApiProperty() requestId!: string;
  @ApiProperty({ enum: WorkerRunStatus }) status!: WorkerRunStatus;
  @ApiProperty({ minimum: 0, maximum: 100 }) progress!: number;
  @ApiProperty({ enum: WorkerInputSource }) inputSource!: WorkerInputSource;
  @ApiPropertyOptional() fixtureCode?: string | null;
  @ApiProperty() attemptCount!: number;
  @ApiProperty() queuedAt!: Date;
  @ApiPropertyOptional() startedAt?: Date | null;
  @ApiPropertyOptional() finishedAt?: Date | null;
  @ApiProperty() requestedBy!: string;
  @ApiProperty({ description: 'Para correlacionar con los registros del motor.' })
  correlationId!: string;
  @ApiPropertyOptional({ description: 'Resultado, cuando la ejecución terminó bien.' })
  result?: unknown;
  @ApiPropertyOptional({ description: 'Advertencias de un resultado utilizable pero revisable.' })
  warnings?: unknown;
  @ApiPropertyOptional() errorCode?: string | null;
  @ApiPropertyOptional() errorMessage?: string | null;
}

export class WorkerRunQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(WorkerRunStatus)
  @ApiPropertyOptional({ enum: WorkerRunStatus })
  status?: WorkerRunStatus;
}

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
  @ApiProperty({ enum: STATEMENT_DOWNLOAD_FORMATS, default: 'csv' })
  format: StatementDownloadFormat = 'csv';
}
