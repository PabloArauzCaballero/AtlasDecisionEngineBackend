import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  StatementRejectionReason,
  StatementReviewReason,
  WorkerInputSource,
  WorkerRunStatus,
} from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/http/pagination';

/**
 * Los workers que este motor publica.
 *
 * Una sola lista y no una por sitio: el catálogo, las métricas y cualquier ruta
 * que reciba un `:code` se validan contra ella, de modo que añadir un worker
 * tercero no deje una superficie contestando por un código que ya no existe.
 */
export const WORKER_CODES = [
  'semantic-analysis',
  'bank-statement',
  'identity-verification',
  'audio-tts',
] as const;
export type WorkerCode = (typeof WORKER_CODES)[number];

export function isWorkerCode(value: string): value is WorkerCode {
  return (WORKER_CODES as readonly string[]).includes(value);
}

/** Escenario de prueba servido al frontend. */
export class WorkerFixtureDto {
  @ApiProperty({ example: 'gasto-claro' }) code!: string;
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
  @ApiPropertyOptional({
    description:
      'Sólo extractos con el emisor en duda: el análisis completo (movimientos, ingresos, gastos, capacidad) ' +
      'para que una persona decida. NO es un resultado aplicable: el consumidor sigue leyendo `result`.',
  })
  provisionalResult?: unknown;
  @ApiPropertyOptional({
    description:
      'Sólo extractos: el titular exigido (el cliente que lo subió), el que se leyó en el documento y el ' +
      'veredicto (`MATCH`, `MISMATCH`, `UNREADABLE`, `NOT_REQUIRED`).',
  })
  holder?: { expected: string | null; read: string | null; verdict: string | null } | null;
  @ApiPropertyOptional({ description: 'Advertencias de un resultado utilizable pero revisable.' })
  warnings?: unknown;
  @ApiPropertyOptional() errorCode?: string | null;
  @ApiPropertyOptional() errorMessage?: string | null;
  /*
   * El estado dice DÓNDE está el caso; estos dos dicen QUÉ pasó, y viajan
   * siempre que existan porque son lo que la pantalla necesita para elegir el
   * mensaje. Sin ellos, `PENDING_REVIEW` obligaba a anunciar «enviado a revisión»
   * en genérico —sin distinguir el timeout de la baja confianza— que es
   * exactamente el aviso que no informa de nada.
   */
  @ApiPropertyOptional({
    enum: StatementReviewReason,
    description: 'Por qué espera a una persona. Sólo con estado PENDING_REVIEW o IN_REVIEW.',
  })
  reviewReason?: StatementReviewReason | null;
  @ApiPropertyOptional({
    enum: StatementRejectionReason,
    description: 'Por qué se rechazó. Sólo con estado PDF_INVALID.',
  })
  rejectionReason?: StatementRejectionReason | null;
  @ApiPropertyOptional({ description: '1 alta · 2 media · 3 baja.' })
  reviewPriority?: number | null;
  @ApiPropertyOptional({
    description:
      'Sólo al encolar: `true` si ese mismo archivo ya estaba en el motor y se devuelve su ejecución en vez de crear otra.',
  })
  deduplicated?: boolean;
}

export class WorkerRunQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(WorkerRunStatus)
  @ApiPropertyOptional({ enum: WorkerRunStatus })
  status?: WorkerRunStatus;
}
