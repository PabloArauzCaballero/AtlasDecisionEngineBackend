import { ApiProperty } from '@nestjs/swagger';

class ArtifactRefDto {
  @ApiProperty({ example: '4000' }) id!: string;
  @ApiProperty({ example: 'CREDIT_LIMIT_V2' }) artifactCode!: string;
  @ApiProperty({ example: 'Credit limit assignment' }) name!: string;
}

class PolicyArtifactVersionRefDto {
  @ApiProperty({ example: '4001' }) id!: string;
  @ApiProperty({ example: 3 }) versionNumber!: number;
  @ApiProperty({ example: 'DEPLOYED_TO_PROD' }) status!: string;
  @ApiProperty({ type: ArtifactRefDto }) artifact!: ArtifactRefDto;
}

class PolicyArtifactLinkDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: '1' }) policyRequirementId!: string;
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
  @ApiProperty({ type: PolicyArtifactVersionRefDto }) artifactVersion!: PolicyArtifactVersionRefDto;
}

class PolicyTestSuiteRefDto {
  @ApiProperty({ example: '7001' }) id!: string;
  @ApiProperty({ example: 'REGRESSION_V1' }) suiteCode!: string;
  @ApiProperty({ example: 'Regression suite v1' }) name!: string;
}

class PolicyTestLinkDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: '1' }) policyRequirementId!: string;
  @ApiProperty({ example: '7001' }) testSuiteId!: string;
  @ApiProperty({ type: PolicyTestSuiteRefDto }) testSuite!: PolicyTestSuiteRefDto;
}

export class PolicyRequirementDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: '1' }) businessObjectiveId!: string;
  @ApiProperty({ example: 'NO_ADVERSE_ACTION_WITHOUT_REASON' }) policyCode!: string;
  @ApiProperty({ example: 'Regulation B requires a specific reason for every denial' })
  rationale!: string;
  @ApiProperty({ example: 'compliance@atlas.local' }) owner!: string;
  @ApiProperty({ example: 'CRITICAL' }) severity!: string;
  @ApiProperty({ example: '2026-01-10T09:00:00.000Z' }) createdAt!: string;
  @ApiProperty({ type: [PolicyArtifactLinkDto] }) artifactLinks!: PolicyArtifactLinkDto[];
  @ApiProperty({ type: [PolicyTestLinkDto] }) testLinks!: PolicyTestLinkDto[];
}

class PolicyRequirementCreatedDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: '1' }) businessObjectiveId!: string;
  @ApiProperty({ example: 'NO_ADVERSE_ACTION_WITHOUT_REASON' }) policyCode!: string;
  @ApiProperty() rationale!: string;
  @ApiProperty({ example: 'compliance@atlas.local' }) owner!: string;
  @ApiProperty({ example: 'CRITICAL' }) severity!: string;
  @ApiProperty({ example: '2026-01-10T09:00:00.000Z' }) createdAt!: string;
}

class BusinessObjectiveBaseDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: '1200' }) tenantId!: string;
  @ApiProperty({ example: 'REDUCE_ADVERSE_ACTION_APPEALS' }) objectiveCode!: string;
  @ApiProperty({ example: 'Reduce upheld adverse-action appeals' }) name!: string;
  @ApiProperty({ example: 'upheld_appeal_rate' }) metric!: string;
  @ApiProperty() targetJson!: Record<string, unknown>;
  @ApiProperty({ example: 'risk-engineering' }) ownerTeam!: string;
  @ApiProperty({ example: true }) isActive!: boolean;
  @ApiProperty({ example: '2026-01-10T09:00:00.000Z' }) createdAt!: string;
}

/** `TraceabilityService.createObjective`. */
export class BusinessObjectiveCreatedDto extends BusinessObjectiveBaseDto {
  @ApiProperty({ type: [PolicyRequirementCreatedDto] })
  policyRequirements!: PolicyRequirementCreatedDto[];
}

/** `TraceabilityService.list`: forma anotada con contadores y estado derivado. */
export class BusinessObjectiveListItemDto extends BusinessObjectiveBaseDto {
  @ApiProperty({ type: [PolicyRequirementDto] }) policyRequirements!: PolicyRequirementDto[];
  @ApiProperty({ example: 3 }) policyCount!: number;
  @ApiProperty({ example: 5 }) artifactCount!: number;
  @ApiProperty({ example: 4 }) testCount!: number;
  @ApiProperty({ example: 'ACTIVE', enum: ['ACTIVE', 'INACTIVE'] }) status!: string;
}

/** `TraceabilityService.getObjective`. */
export class BusinessObjectiveDetailDto extends BusinessObjectiveBaseDto {
  @ApiProperty({ type: [PolicyRequirementDto] }) policyRequirements!: PolicyRequirementDto[];
  @ApiProperty({ example: 'ACTIVE', enum: ['ACTIVE', 'INACTIVE'] }) status!: string;
}

class CoverageMatrixObjectiveDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: 'REDUCE_ADVERSE_ACTION_APPEALS' }) objectiveCode!: string;
  @ApiProperty({ example: 'Reduce upheld adverse-action appeals' }) name!: string;
  @ApiProperty({
    example: { NO_ADVERSE_ACTION_WITHOUT_REASON: 'COMPLETE', DUAL_APPROVAL: 'PARTIAL' },
    description: '`{ [policyCode]: "COMPLETE"|"PARTIAL"|"GAP" }`.',
  })
  coverage!: Record<string, string>;
}

/** `TraceabilityService.coverageMatrix`. */
export class CoverageMatrixDto {
  @ApiProperty({
    type: [PolicyRequirementCreatedDto],
    description: 'Solo `id` y `policyCode` de cada política.',
  })
  policies!: Array<{ id: string; policyCode: string }>;
  @ApiProperty({ type: [CoverageMatrixObjectiveDto] }) objectives!: CoverageMatrixObjectiveDto[];
  @ApiProperty({ example: 9, description: 'Celdas en estado COMPLETE.' }) covered!: number;
  @ApiProperty({ example: 12, description: 'políticas × objetivos.' }) total!: number;
}

export class PolicyArtifactLinkCreatedDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: '1' }) policyRequirementId!: string;
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
}

export class PolicyTestLinkCreatedDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: '1' }) policyRequirementId!: string;
  @ApiProperty({ example: '7001' }) testSuiteId!: string;
}
