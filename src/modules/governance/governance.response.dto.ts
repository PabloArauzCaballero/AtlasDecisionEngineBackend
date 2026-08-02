import { ApiProperty } from '@nestjs/swagger';

class ApprovalStepRefDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: '1' }) approvalRequestId!: string;
  @ApiProperty({ example: 1 }) stepOrder!: number;
  @ApiProperty({ example: 'RISK_APPROVER' }) requiredRole!: string;
  @ApiProperty({ example: 1 }) minApprovals!: number;
  @ApiProperty({ example: 'PENDING', enum: ['PENDING', 'APPROVED', 'REJECTED'] }) status!: string;
  @ApiProperty({ example: true }) separationOfDuties!: boolean;
}

/** `GovernanceService.listRequests`: `decision_approval_request` anotada para la cola. */
export class ApprovalRequestListItemDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
  @ApiProperty({ example: 'STANDARD_APPROVAL' }) workflowCode!: string;
  @ApiProperty({ example: 'analyst@atlas.local' }) requestedBy!: string;
  @ApiProperty({ example: '2026-07-20T10:30:00.000Z' }) requestedAt!: string;
  @ApiProperty({ example: 'IN_REVIEW', enum: ['IN_REVIEW', 'APPROVED', 'REJECTED'] })
  status!: string;
  @ApiProperty({ nullable: true }) dueAt!: string | null;
  @ApiProperty({ type: [ApprovalStepRefDto] }) steps!: ApprovalStepRefDto[];
  @ApiProperty({
    example: 'CREDIT_LIMIT_V2',
    description: 'Aplanado desde `artifactVersion.artifact`.',
  })
  artifactCode!: string;
  @ApiProperty({ example: 3, description: 'Aplanado desde `artifactVersion`.' })
  versionNumber!: number;
  @ApiProperty({ example: '2026-07-20T10:30:00.000Z', description: 'Alias de `requestedAt`.' })
  createdAt!: string;
  @ApiProperty({
    example: 'RISK_APPROVER',
    description:
      'Rol del paso PENDING actual, o el estado de la solicitud si ninguno está pendiente.',
  })
  currentStep!: string;
  @ApiProperty({ example: 'ON_TRACK', enum: ['ON_TRACK', 'OVERDUE'] }) slaStatus!: string;
}
