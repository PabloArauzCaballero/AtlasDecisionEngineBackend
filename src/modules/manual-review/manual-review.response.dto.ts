import { ApiProperty } from '@nestjs/swagger';

class ExecutionSummaryRefDto {
  @ApiProperty({ example: 'req-8f2a...' }) requestId!: string;
  @ApiProperty({ nullable: true, example: 'MANUAL_REVIEW' }) businessOutcome!: string | null;
  @ApiProperty({ example: '2026-07-20T10:00:00.000Z' }) executedAt!: string;
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
}

/** `ManualReviewService.list`: forma real de `decision_manual_review_case` con la ejecución resumida. */
export class ManualReviewListItemDto {
  @ApiProperty({ example: '12001' }) id!: string;
  @ApiProperty({ example: '88001' }) executionId!: string;
  @ApiProperty({ example: 'MR-2026-0042' }) caseCode!: string;
  @ApiProperty({ example: 'FRAUD_REVIEW' }) queueCode!: string;
  @ApiProperty({ example: 100 }) priority!: number;
  @ApiProperty({
    example: 'OPEN',
    enum: ['OPEN', 'ASSIGNED', 'RESOLVED_APPROVED', 'RESOLVED_DECLINED', 'CANCELLED'],
  })
  status!: string;
  @ApiProperty({ nullable: true, example: 'analyst@atlas.local' }) assignedTo!: string | null;
  @ApiProperty({ example: '2026-07-21T10:00:00.000Z' }) dueAt!: string;
  @ApiProperty() evidenceJson!: Record<string, unknown>;
  @ApiProperty({ nullable: true }) resolutionJson!: Record<string, unknown> | null;
  @ApiProperty({ example: '2026-07-20T10:00:00.000Z' }) createdAt!: string;
  @ApiProperty({ nullable: true }) resolvedAt!: string | null;
  @ApiProperty({ type: ExecutionSummaryRefDto }) execution!: ExecutionSummaryRefDto;
}

class ExecutionVariableRefDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ nullable: true }) valueJson!: unknown;
  @ApiProperty({ example: 'a1b2c3...' }) valueHash!: string;
  @ApiProperty({ example: 'REQUEST' }) sourceCode!: string;
  @ApiProperty({ example: 'VALID' }) resolutionStatus!: string;
  @ApiProperty({ example: false }) wasDefaulted!: boolean;
  @ApiProperty({
    example: { code: 'applicant_income', definition: { variableCode: 'applicant_income' } },
  })
  variableVersion!: Record<string, unknown>;
}

class ExecutionStepRefDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: 1 }) stepOrder!: number;
  @ApiProperty() evaluationResultJson!: Record<string, unknown>;
  @ApiProperty({ nullable: true }) branchTaken!: string | null;
  @ApiProperty({ example: '1200' }) durationUs!: string;
  @ApiProperty({ example: { nodeKey: 'CHECK_INCOME', nodeType: 'CONDITION' } }) node!: Record<
    string,
    unknown
  >;
}

class ExecutionReasonRefDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: 100 }) priority!: number;
  @ApiProperty({ example: 'Manual review required for elevated fraud score' })
  renderedMessage!: string;
  @ApiProperty({ example: { code: 'ELEVATED_FRAUD_SCORE', category: 'FRAUD' } })
  reasonCode!: Record<string, unknown>;
}

class ExecutionDetailRefDto {
  @ApiProperty({ example: '88001' }) id!: string;
  @ApiProperty({ example: 'req-8f2a...' }) requestId!: string;
  @ApiProperty({ nullable: true }) businessOutcome!: string | null;
  @ApiProperty({ example: '2026-07-20T10:00:00.000Z' }) executedAt!: string;
  @ApiProperty({ example: { artifactCode: 'CREDIT_LIMIT_V2', versionNumber: 3 } })
  artifactVersion!: Record<string, unknown>;
  @ApiProperty({ type: [ExecutionVariableRefDto] }) variables!: ExecutionVariableRefDto[];
  @ApiProperty({ type: [ExecutionStepRefDto] }) steps!: ExecutionStepRefDto[];
  @ApiProperty({ type: [ExecutionReasonRefDto] }) reasons!: ExecutionReasonRefDto[];
}

/** `ManualReviewService.get`: caso con la traza completa de la ejecución que lo originó. */
export class ManualReviewDetailDto {
  @ApiProperty({ example: '12001' }) id!: string;
  @ApiProperty({ example: '88001' }) executionId!: string;
  @ApiProperty({ example: 'MR-2026-0042' }) caseCode!: string;
  @ApiProperty({ example: 'FRAUD_REVIEW' }) queueCode!: string;
  @ApiProperty({ example: 100 }) priority!: number;
  @ApiProperty({ example: 'OPEN' }) status!: string;
  @ApiProperty({ nullable: true }) assignedTo!: string | null;
  @ApiProperty({ example: '2026-07-21T10:00:00.000Z' }) dueAt!: string;
  @ApiProperty() evidenceJson!: Record<string, unknown>;
  @ApiProperty({ nullable: true }) resolutionJson!: Record<string, unknown> | null;
  @ApiProperty({ example: '2026-07-20T10:00:00.000Z' }) createdAt!: string;
  @ApiProperty({ nullable: true }) resolvedAt!: string | null;
  @ApiProperty({ type: ExecutionDetailRefDto }) execution!: ExecutionDetailRefDto;
}

/** `ManualReviewService.assign` / `.resolve`: forma real de `decision_manual_review_case` tras la escritura. */
export class ManualReviewWriteResultDto {
  @ApiProperty({ example: '12001' }) id!: string;
  @ApiProperty({ example: '88001' }) executionId!: string;
  @ApiProperty({ example: 'MR-2026-0042' }) caseCode!: string;
  @ApiProperty({ example: 'FRAUD_REVIEW' }) queueCode!: string;
  @ApiProperty({ example: 100 }) priority!: number;
  @ApiProperty({
    example: 'ASSIGNED',
    enum: ['OPEN', 'ASSIGNED', 'RESOLVED_APPROVED', 'RESOLVED_DECLINED', 'CANCELLED'],
  })
  status!: string;
  @ApiProperty({ nullable: true, example: 'analyst@atlas.local' }) assignedTo!: string | null;
  @ApiProperty({ example: '2026-07-21T10:00:00.000Z' }) dueAt!: string;
  @ApiProperty() evidenceJson!: Record<string, unknown>;
  @ApiProperty({ nullable: true }) resolutionJson!: Record<string, unknown> | null;
  @ApiProperty({ example: '2026-07-20T10:00:00.000Z' }) createdAt!: string;
  @ApiProperty({ nullable: true }) resolvedAt!: string | null;
}
