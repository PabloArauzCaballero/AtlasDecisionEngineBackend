import { ApiProperty } from '@nestjs/swagger';
import { DATA_SUBJECT_REQUEST_TYPES } from './data-subject.dto';

const STATUSES = ['RECEIVED', 'FULFILLED', 'REJECTED'] as const;

class DecisionReasonRefDto {
  @ApiProperty({ example: 'INSUFFICIENT_INCOME' }) code!: string;
  /** El mensaje PÚBLICO. El interno nunca sale hacia el titular. */
  @ApiProperty({ example: 'Ingresos insuficientes para el importe solicitado' }) message!: string;
  @ApiProperty({ example: true }) adverseAction!: boolean;
}

/** Una decisión tomada sobre el titular, tal como se le entrega. */
export class DataSubjectDecisionDto {
  @ApiProperty({ example: '88001' }) executionId!: string;
  @ApiProperty({ example: 'req-8f2a' }) requestId!: string;
  @ApiProperty({ example: 'SUCCEEDED' }) status!: string;
  @ApiProperty({ nullable: true, example: 'DECLINED' }) outcome!: string | null;
  @ApiProperty({ example: '2026-03-01T00:00:00.000Z' }) executedAt!: string;
  @ApiProperty({ example: 'CREDIT_ORIGINATION' }) artifactCode!: string;
  @ApiProperty({ example: 'Originación de crédito al consumo' }) artifactName!: string;
  @ApiProperty({ example: 3 }) versionNumber!: number;
  @ApiProperty({ type: [DecisionReasonRefDto] }) reasons!: DecisionReasonRefDto[];
}

export class DataSubjectRequestResultDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ enum: DATA_SUBJECT_REQUEST_TYPES }) requestType!: string;
  @ApiProperty({ enum: STATUSES }) status!: string;
  @ApiProperty({ example: '2026-08-08T10:00:00.000Z' }) createdAt!: string;
  @ApiProperty({ example: 4, description: 'Decisiones encontradas sobre este titular.' })
  matchedDecisions!: number;
  @ApiProperty({
    type: [DataSubjectDecisionDto],
    required: false,
    description:
      'Solo en ACCESS y PORTABILITY. Una eliminación responde con su alcance, no con el ' +
      'contenido que no va a borrar.',
  })
  decisions?: DataSubjectDecisionDto[];
  @ApiProperty({
    description:
      'Alcance de lo entregado o motivo del rechazo. `truncated: true` avisa de que la ' +
      'entrega llegó al techo por respuesta.',
    example: { matchedDecisions: 4, truncated: false, scope: 'Decisiones y motivos públicos' },
  })
  resolution!: Record<string, unknown>;
}

class DataSubjectRequestHistoryItemDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ enum: DATA_SUBJECT_REQUEST_TYPES }) requestType!: string;
  @ApiProperty({ enum: STATUSES }) status!: string;
  @ApiProperty({ example: 'compliance@atlas.local' }) receivedBy!: string;
  @ApiProperty({ nullable: true, example: 'TICKET-9912' }) reference!: string | null;
  @ApiProperty({ example: '2026-08-08T10:00:00.000Z' }) createdAt!: string;
  @ApiProperty({ nullable: true }) resolvedAt!: string | null;
}

export class DataSubjectRequestHistoryDto {
  @ApiProperty({ example: 3 }) total!: number;
  @ApiProperty({ type: [DataSubjectRequestHistoryItemDto] })
  items!: DataSubjectRequestHistoryItemDto[];
}
