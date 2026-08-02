import { ApiProperty } from '@nestjs/swagger';

/**
 * Formas de respuesta de la bandeja. Se declaran porque el portal las consume para pintar
 * el contador de la campana: sin esquema, un integrador tiene que deducir el nombre del
 * campo probando.
 */
export class UnreadCountResponseDto {
  @ApiProperty({ example: 7, description: 'Notificaciones sin leer visibles para el llamante.' })
  unread!: number;
}

export class MarkAllReadResponseDto {
  @ApiProperty({
    example: 7,
    description:
      'Notificaciones que pasaron a leídas en esta llamada. Es 0 si ya estaban todas leídas: la operación es idempotente.',
  })
  updated!: number;
}

/** Forma real de `notification`, tal como la devuelve `markRead`. */
export class NotificationDto {
  @ApiProperty({ example: '20001' }) id!: string;
  @ApiProperty({ nullable: true, example: 'RISK_ANALYST' }) recipientRole!: string | null;
  @ApiProperty({ nullable: true, example: 'analyst@atlas.local' }) recipientId!: string | null;
  @ApiProperty({ example: 'MANUAL_REVIEW' }) category!: string;
  @ApiProperty({ example: 'NORMAL', enum: ['LOW', 'NORMAL', 'HIGH'] }) priority!: string;
  @ApiProperty({ example: 'New case assigned to your queue' }) title!: string;
  @ApiProperty({ example: 'Case MR-2026-0042 requires review before its SLA.' }) body!: string;
  @ApiProperty({ nullable: true, example: 'ManualReviewCase' }) entityType!: string | null;
  @ApiProperty({ nullable: true, example: '12001' }) entityId!: string | null;
  @ApiProperty({ nullable: true, example: '/reviews/12001' }) actionUrl!: string | null;
  @ApiProperty({ example: 'MANUAL_REVIEW_CASE_OPENED' }) eventType!: string;
  @ApiProperty({ nullable: true }) correlationId!: string | null;
  @ApiProperty({ nullable: true }) readAt!: string | null;
  @ApiProperty({ example: '2026-07-20T10:00:00.000Z' }) createdAt!: string;
}
