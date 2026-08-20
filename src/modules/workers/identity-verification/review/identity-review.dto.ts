/**
 * Contratos HTTP de la cola de arbitraje de identidad.
 *
 * Archivo propio y no dentro de `workers.dto.ts` porque esto no es el ciclo de
 * vida de una ejecución: es una cola de TRABAJO HUMANO, con su filtro, su
 * prioridad, su antigüedad y sus dos acciones. Compartirlo habría vuelto a
 * mezclar las dos preguntas que este trabajo separa —«¿qué pasó con lo que
 * subí?» y «¿qué tengo que decidir?»—.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IdentityRejectionReason,
  IdentityReviewReason,
  WorkerRunStatus,
} from '@prisma/client';
import { IsEnum, IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../../common/http/pagination';
import { IdentityDocumentType } from '../core/domain/identity-enums';

/** Los dos estados en los que un caso está en la cola. */
export const IDENTITY_QUEUE_STATUSES = [
  WorkerRunStatus.PENDING_REVIEW,
  WorkerRunStatus.IN_REVIEW,
] as const;

/**
 * Filtro de la cola. Todo opcional y todo aplicado en el SERVIDOR: la lista
 * puede crecer sin cota, y traérsela entera al navegador para filtrarla ahí es
 * la forma de que la pantalla se vuelva inusable justo cuando hay trabajo.
 */
export class IdentityReviewQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: IdentityReviewReason,
    description: 'La pestaña. Omitirlo es «Todos».',
  })
  @IsOptional()
  @IsEnum(IdentityReviewReason)
  category?: IdentityReviewReason;

  @ApiPropertyOptional({
    enum: IDENTITY_QUEUE_STATUSES,
    description: 'Sin reclamar o ya reclamado. Omitirlo trae los dos.',
  })
  @IsOptional()
  @IsIn(IDENTITY_QUEUE_STATUSES)
  status?: (typeof IDENTITY_QUEUE_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Desde cuándo entró en la cola (ISO-8601).' })
  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Hasta cuándo entró en la cola (ISO-8601).' })
  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}

/** Un caso, plegado a lo que hace falta para priorizarlo sin abrirlo. */
export class IdentityReviewItemDto {
  @ApiProperty() requestId!: string;
  @ApiProperty({ description: 'Quién pidió la verificación.' }) requestedBy!: string;
  @ApiProperty({ enum: IDENTITY_QUEUE_STATUSES }) status!: WorkerRunStatus;
  @ApiProperty({ enum: IdentityReviewReason }) reviewReason!: IdentityReviewReason;
  @ApiProperty({ description: '1 alta · 2 media · 3 baja.' }) reviewPriority!: number | null;
  @ApiProperty({ description: 'Quién arbitra este caso: HUMAN o AI.' })
  arbitrationMode!: string | null;
  @ApiProperty({ description: 'Tipo de documento reconocido, si se reconoció alguno.' })
  documentType!: string | null;
  @ApiProperty() documentCountry!: string;
  @ApiProperty({
    description:
      'Confianza de que la imagen SEA un documento de identidad. Es la medida que lo trajo aquí.',
  })
  documentTypeConfidence!: number | null;
  @ApiProperty({ description: 'Código técnico que originó la derivación.' })
  errorCode!: string | null;
  @ApiProperty({ description: 'Qué vio la puerta, en una frase legible.' })
  errorMessage!: string | null;
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
export class IdentityReviewCategoryDto {
  @ApiProperty({ enum: IdentityReviewReason, nullable: true, description: '`null` = «Todos».' })
  category!: IdentityReviewReason | null;
  @ApiProperty() total!: number;
  @ApiProperty({ description: 'De ese total, cuántos ya tienen a alguien encima.' })
  claimed!: number;
  @ApiProperty({ description: 'Antigüedad del más viejo, en milisegundos.' })
  oldestPendingMs!: number | null;
}

/**
 * Qué puede hacer quien arbitra. Dos acciones y no cuatro, porque la pregunta
 * que se le hizo es una sola: **¿esto es un documento de identidad admisible?**
 *
 * `CONFIRM_DOCUMENT` obliga a nombrar el tipo, y no es burocracia: sin tipo no
 * hay analizador, y reencolar sin él devolvería el caso a la misma cola por el
 * mismo motivo. El bucle es exactamente lo que ese campo impide.
 */
export const IDENTITY_REVIEW_ACTIONS = ['CONFIRM_DOCUMENT', 'REJECT_DOCUMENT'] as const;
export type IdentityReviewAction = (typeof IDENTITY_REVIEW_ACTIONS)[number];

const TIPOS_CONFIRMABLES = [
  IdentityDocumentType.BOLIVIA_CI,
  IdentityDocumentType.PASSPORT,
  IdentityDocumentType.DRIVER_LICENSE,
] as const;

export class ResolveIdentityReviewDto {
  @ApiProperty({
    enum: IDENTITY_REVIEW_ACTIONS,
    description:
      'CONFIRM_DOCUMENT afirma que sí es el documento y devuelve la ejecución a la cola del worker · REJECT_DOCUMENT la cierra afirmando que no lo era.',
  })
  @IsIn(IDENTITY_REVIEW_ACTIONS)
  action!: IdentityReviewAction;

  @ApiPropertyOptional({
    enum: TIPOS_CONFIRMABLES,
    description:
      'Obligatorio con CONFIRM_DOCUMENT: es lo que elige el analizador cuando la ejecución se reanude.',
  })
  @IsOptional()
  @IsIn(TIPOS_CONFIRMABLES)
  documentType?: (typeof TIPOS_CONFIRMABLES)[number];

  @ApiPropertyOptional({
    enum: IdentityRejectionReason,
    description: 'Obligatorio con REJECT_DOCUMENT: un rechazo sin motivo no es medible.',
  })
  @IsOptional()
  @IsEnum(IdentityRejectionReason)
  rejectionReason?: IdentityRejectionReason;

  @ApiProperty({ description: 'Por qué. Queda en la fila y en la auditoría.' })
  @IsString()
  @MaxLength(2_000)
  notes!: string;
}

/** Lo que devuelve confirmar: la ejecución vuelve a la cola del worker. */
export class IdentityReviewResolvedDto {
  @ApiProperty() requestId!: string;
  @ApiProperty({
    enum: [WorkerRunStatus.QUEUED, WorkerRunStatus.DOCUMENT_REJECTED],
    description:
      '`QUEUED` si se confirmó —el worker retoma desde el principio con el tipo ya decidido— o `DOCUMENT_REJECTED` si se rechazó.',
  })
  status!: WorkerRunStatus;
  @ApiProperty({ description: 'Quién lo resolvió.' }) resolvedBy!: string;
}
