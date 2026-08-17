/**
 * Contratos HTTP de la cola de revisión de extractos.
 *
 * Archivo propio y no dentro de `workers.dto.ts` porque esto no es el ciclo de
 * vida de una ejecución: es una cola de TRABAJO HUMANO, con su filtro, su
 * prioridad, su antigüedad y sus acciones. Compartirlo habría vuelto a mezclar
 * las dos cosas que este trabajo separa.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StatementRejectionReason, StatementReviewReason, WorkerRunStatus } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../../common/http/pagination';

/** Los dos estados en los que un caso está en la cola. */
export const REVIEW_QUEUE_STATUSES = [
  WorkerRunStatus.PENDING_REVIEW,
  WorkerRunStatus.IN_REVIEW,
] as const;

/**
 * Filtro de la cola. Todo es opcional y todo se aplica en el SERVIDOR: la lista
 * puede crecer sin cota y traérsela entera al navegador para filtrarla ahí es la
 * forma de que la pantalla se vuelva inusable justo cuando hay trabajo.
 */
export class StatementReviewQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: StatementReviewReason,
    description: 'La pestaña. Omitirlo es «Todos».',
  })
  @IsOptional()
  @IsEnum(StatementReviewReason)
  category?: StatementReviewReason;

  @ApiPropertyOptional({
    enum: REVIEW_QUEUE_STATUSES,
    description: 'Sin reclamar o ya reclamado. Omitirlo trae los dos.',
  })
  @IsOptional()
  @IsIn(REVIEW_QUEUE_STATUSES)
  status?: (typeof REVIEW_QUEUE_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Código de entidad detectada.' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  bank?: string;

  @ApiPropertyOptional({ description: 'Desde cuándo entró en la cola (ISO-8601).' })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Hasta cuándo entró en la cola (ISO-8601).' })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @ApiPropertyOptional({ description: '1 alta · 2 media · 3 baja.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  priority?: number;
}

/** Un caso, plegado a lo que hace falta para priorizar sin abrirlo. */
export class StatementReviewItemDto {
  @ApiProperty() requestId!: string;
  @ApiProperty() fileName!: string;
  @ApiProperty({ description: 'Quién lo subió.' }) requestedBy!: string;
  @ApiProperty({ enum: REVIEW_QUEUE_STATUSES }) status!: WorkerRunStatus;
  @ApiProperty({ enum: StatementReviewReason }) reviewReason!: StatementReviewReason;
  @ApiProperty({ description: '1 alta · 2 media · 3 baja.' }) reviewPriority!: number;
  @ApiProperty({ description: 'Código técnico que originó la derivación.' })
  errorCode!: string | null;
  @ApiProperty() errorMessage!: string | null;
  @ApiProperty({ description: 'Entidad detectada, si se reconoció.' })
  institutionId!: string | null;
  @ApiProperty({ description: 'Confianza de que SEA un extracto. `null` si no se midió.' })
  documentTypeConfidence!: number | null;
  @ApiProperty({ description: 'Confianza de la EXTRACCIÓN de movimientos.' })
  extractionConfidence!: number | null;
  @ApiProperty() transactionCount!: number | null;
  @ApiProperty({ description: 'Cuándo entró en la cola.' }) reviewOpenedAt!: Date | null;
  @ApiProperty({
    description:
      'Milisegundos que lleva esperando. Lo calcula el motor: derivarlo en el cliente lo deja congelado en la hora de su reloj.',
  })
  pendingMs!: number | null;
  @ApiProperty() reviewClaimedBy!: string | null;
  @ApiProperty() reviewClaimedAt!: Date | null;
  @ApiProperty() queuedAt!: Date;
}

/** Contador de una pestaña. */
export class StatementReviewCategoryDto {
  @ApiProperty({ enum: StatementReviewReason, nullable: true, description: '`null` = «Todos».' })
  category!: StatementReviewReason | null;
  @ApiProperty() total!: number;
  @ApiProperty({ description: 'De ese total, cuántos ya tienen a alguien encima.' })
  claimed!: number;
  @ApiProperty({ description: 'Antigüedad del más viejo, en milisegundos.' })
  oldestPendingMs!: number | null;
}

/**
 * Lo que devuelve reencolar. Se describe con una clase y no con una descripción
 * suelta porque un consumidor no puede tipar lo que no está descrito: el gate de
 * calidad del contrato (`check-openapi-quality.mjs`) lo exige a cada operación
 * nueva, y con razón — una respuesta sin esquema obliga a leer el código del
 * motor para saber qué llega.
 */
export class StatementReprocessedDto {
  @ApiProperty() requestId!: string;
  @ApiProperty({
    enum: [WorkerRunStatus.QUEUED],
    description: 'Siempre `QUEUED`: el caso vuelve a la cola del worker.',
  })
  status!: WorkerRunStatus;
}

/** Qué se puede hacer con un pendiente. */
export const REVIEW_ACTIONS = ['APPROVE', 'CORRECT', 'REJECT', 'MARK_INVALID'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export class ResolveStatementReviewDto {
  @ApiProperty({
    enum: REVIEW_ACTIONS,
    description:
      'APPROVE da por bueno lo extraído · CORRECT lo da por bueno con notas de corrección · REJECT lo cierra sin resultado · MARK_INVALID afirma que no era un extracto.',
  })
  @IsIn(REVIEW_ACTIONS)
  action!: ReviewAction;

  @ApiPropertyOptional({
    enum: StatementRejectionReason,
    description: 'Obligatorio con MARK_INVALID: un rechazo sin motivo no es medible.',
  })
  @IsOptional()
  @IsEnum(StatementRejectionReason)
  rejectionReason?: StatementRejectionReason;

  @ApiProperty({ description: 'Por qué. Queda en la fila y en la auditoría.' })
  @IsString()
  @MaxLength(2_000)
  notes!: string;
}
