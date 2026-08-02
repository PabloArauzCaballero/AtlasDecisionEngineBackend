import { ApiProperty } from '@nestjs/swagger';

class SecurityFindingDto {
  @ApiProperty({ example: 'HIGH', enum: ['LOW', 'MEDIUM', 'HIGH'] }) severity!: string;
  @ApiProperty({ example: 'CONTAINS_SCRIPT_NODES' }) code!: string;
  @ApiProperty({
    example:
      'This version runs 1 script node(s) (JAVASCRIPT) — verify the sandbox mode before approving.',
  })
  message!: string;
}

class ReviewArtifactRefDto {
  @ApiProperty({ example: '4000' }) id!: string;
  @ApiProperty({ example: 'CREDIT_LIMIT_V2' }) artifactCode!: string;
  @ApiProperty({ example: 'Credit limit assignment' }) name!: string;
  @ApiProperty({ example: 'CREDIT_RISK' }) riskDomain!: string;
}

class ReviewVersionRefDto {
  @ApiProperty({ example: '4001' }) id!: string;
  @ApiProperty({ example: 3 }) versionNumber!: number;
  @ApiProperty({ example: 'IN_REVIEW' }) status!: string;
  @ApiProperty({ example: '1.2.0' }) semanticVersion!: string;
  @ApiProperty({ example: 'analyst@atlas.local' }) createdBy!: string;
  @ApiProperty({ example: '2026-07-15T09:00:00.000Z' }) createdAt!: string;
  @ApiProperty({ nullable: true }) canonicalChecksum!: string | null;
}

class ReviewCodeEntryDto {
  @ApiProperty({ example: 'CALC_DTI' }) nodeKey!: string;
  @ApiProperty({ example: 'JAVASCRIPT' }) language!: string;
  @ApiProperty({ example: 'a1b2c3...' }) checksum!: string;
  @ApiProperty({ example: 'if (income > 5000) { ...', description: 'Recortada a 2000 caracteres.' })
  sourceExcerpt!: string;
}

class ReviewVariableDto {
  @ApiProperty({ example: 'applicant_income' }) code!: string;
  @ApiProperty({ example: 'INPUT' }) usageType!: string;
  @ApiProperty({ example: 'INTERNAL' }) dataClassification!: string;
  @ApiProperty({ example: false }) isSensitive!: boolean;
}

class ReviewNestedDependsOnDto {
  @ApiProperty({ example: 'CHECK_BUREAU' }) nodeKey!: string;
  @ApiProperty({ example: '4200' }) childArtifactId!: string;
  @ApiProperty({ example: '4201' }) childArtifactVersionId!: string;
}

class ReviewNestedDependedOnByDto {
  @ApiProperty({ example: '3900' }) parentArtifactVersionId!: string;
  @ApiProperty({ example: 'CHECK_BUREAU' }) nodeKey!: string;
}

class ReviewNestedTreesDto {
  @ApiProperty({ type: [ReviewNestedDependsOnDto] }) dependsOn!: ReviewNestedDependsOnDto[];
  @ApiProperty({ type: [ReviewNestedDependedOnByDto] })
  dependedOnBy!: ReviewNestedDependedOnByDto[];
}

class ReviewStaticAnalysisDto {
  @ApiProperty({ example: '9001' }) id!: string;
  @ApiProperty({ example: 'JAVASCRIPT' }) language!: string;
  @ApiProperty({ example: 'CONFIRMED' }) status!: string;
  @ApiProperty({ type: [Object] }) issues!: unknown;
}

class ReviewApprovalDecisionDto {
  @ApiProperty({ example: 'approver@atlas.local' }) decidedBy!: string;
  @ApiProperty({ example: 'APPROVED', enum: ['APPROVED', 'REJECTED'] }) decision!: string;
  @ApiProperty({ nullable: true }) comments!: string | null;
  @ApiProperty({ example: '2026-07-20T11:00:00.000Z' }) decidedAt!: string;
}

class ReviewApprovalStepDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: 1 }) stepOrder!: number;
  @ApiProperty({ example: 'RISK_APPROVER' }) requiredRole!: string;
  @ApiProperty({ example: 'PENDING', enum: ['PENDING', 'APPROVED', 'REJECTED'] }) status!: string;
  @ApiProperty({ type: [ReviewApprovalDecisionDto] }) decisions!: ReviewApprovalDecisionDto[];
}

class ReviewGovernanceDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: 'STANDARD_APPROVAL' }) workflowCode!: string;
  @ApiProperty({ example: 'IN_REVIEW' }) status!: string;
  @ApiProperty({ example: 'analyst@atlas.local' }) requestedBy!: string;
  @ApiProperty({ example: '2026-07-20T10:30:00.000Z' }) requestedAt!: string;
  @ApiProperty({ type: [ReviewApprovalStepDto] }) steps!: ReviewApprovalStepDto[];
}

class ReviewIncidentDto {
  @ApiProperty({ example: '99001' }) id!: string;
  @ApiProperty({ example: 'VALIDATION_FAILED' }) eventType!: string;
  @ApiProperty({ example: 'analyst@atlas.local' }) actorId!: string;
  @ApiProperty({ example: '2026-07-18T09:00:00.000Z' }) occurredAt!: string;
  @ApiProperty({ example: '4000' }) artifactId!: string;
  @ApiProperty({ example: '4001' }) versionId!: string;
}

class ReviewRecentExecutionDto {
  @ApiProperty({ example: '88001' }) id!: string;
  @ApiProperty({ example: 'SUCCEEDED' }) status!: string;
  @ApiProperty({ example: '2026-07-20T10:00:00.000Z' }) executedAt!: string;
  @ApiProperty({ example: 0 }) errorCount!: number;
}

class ReviewExecutionsDto {
  @ApiProperty({ example: 20 }) total!: number;
  @ApiProperty({ example: 0 }) withErrors!: number;
  @ApiProperty({ type: [ReviewRecentExecutionDto] }) recent!: ReviewRecentExecutionDto[];
}

/**
 * `SecurityReviewService.getVersionReview` / `.exportReport`: agregación de solo lectura sobre
 * autoría, variables, referencias anidadas, importación de código, gobierno, auditoría y
 * ejecuciones. `exportReport` devuelve exactamente esta misma forma.
 */
export class SecurityReviewDto {
  @ApiProperty({ type: ReviewArtifactRefDto }) artifact!: ReviewArtifactRefDto;
  @ApiProperty({ type: ReviewVersionRefDto }) version!: ReviewVersionRefDto;
  @ApiProperty({ example: 'MEDIUM', enum: ['LOW', 'MEDIUM', 'HIGH'] }) severity!: string;
  @ApiProperty({ type: [SecurityFindingDto] }) findings!: SecurityFindingDto[];
  @ApiProperty({ type: [ReviewCodeEntryDto] }) code!: ReviewCodeEntryDto[];
  @ApiProperty({ type: [ReviewVariableDto] }) variables!: ReviewVariableDto[];
  @ApiProperty({ type: ReviewNestedTreesDto }) nestedTrees!: ReviewNestedTreesDto;
  @ApiProperty({ type: [ReviewStaticAnalysisDto] }) staticAnalysis!: ReviewStaticAnalysisDto[];
  @ApiProperty({ type: [ReviewGovernanceDto] }) governance!: ReviewGovernanceDto[];
  @ApiProperty({
    type: [ReviewIncidentDto],
    description: 'Últimos 50 eventos de auditoría de la versión.',
  })
  incidents!: ReviewIncidentDto[];
  @ApiProperty({ type: ReviewExecutionsDto, description: 'Últimas 20 ejecuciones.' })
  executions!: ReviewExecutionsDto;
}
