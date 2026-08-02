import { ApiProperty } from '@nestjs/swagger';

/** Forma real de `decision_environment`. */
export class DeploymentEnvironmentDto {
  @ApiProperty({ example: '2' }) id!: string;
  @ApiProperty({ example: 'PROD' }) code!: string;
  @ApiProperty({ example: 'Production' }) name!: string;
  @ApiProperty({ example: 'PRODUCTION' }) environmentType!: string;
  @ApiProperty({ example: 'ACTIVE' }) status!: string;
  @ApiProperty({ example: true }) isProduction!: boolean;
  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' }) createdAt!: string;
}

class TrafficRuleDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: 'default' }) segmentKey!: string;
  @ApiProperty({ example: 100 }) trafficPercentage!: number;
  @ApiProperty({ nullable: true }) routingExpressionJson!: Record<string, unknown> | null;
  @ApiProperty({ example: 1 }) priority!: number;
}

class DeploymentArtifactRefDto {
  @ApiProperty({ example: '4001' }) id!: string;
  @ApiProperty({ example: 3 }) versionNumber!: number;
  @ApiProperty({ example: 'DEPLOYED_TO_PROD' }) status!: string;
  @ApiProperty({ example: { artifactCode: 'CREDIT_LIMIT_V2', name: 'Credit limit assignment' } })
  artifact!: { artifactCode: string; name: string };
}

/** `DeploymentService.list`: fila real de `decision_deployment`. */
export class DeploymentListItemDto {
  @ApiProperty({ example: '55001' }) id!: string;
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
  @ApiProperty({ example: '77001' }) compiledArtifactId!: string;
  @ApiProperty({ example: '2' }) environmentId!: string;
  @ApiProperty({ example: 'ROLLING' }) deploymentMode!: string;
  @ApiProperty({
    example: 'ACTIVE',
    enum: ['PENDING', 'ACTIVE', 'SUPERSEDED', 'SUSPENDED', 'ROLLED_BACK'],
  })
  deploymentStatus!: string;
  @ApiProperty({ example: '2026-07-20T10:10:00.000Z' }) effectiveFrom!: string;
  @ApiProperty({ nullable: true }) effectiveTo!: string | null;
  @ApiProperty({ example: true }) isActive!: boolean;
  @ApiProperty({ nullable: true }) previousDeploymentId!: string | null;
  @ApiProperty({ nullable: true }) rollbackOfDeploymentId!: string | null;
  @ApiProperty({ example: 'admin@atlas.local' }) deployedBy!: string;
  @ApiProperty({ example: '2026-07-20T10:10:00.000Z' }) deployedAt!: string;
  @ApiProperty({ type: DeploymentEnvironmentDto }) environment!: DeploymentEnvironmentDto;
  @ApiProperty({ type: DeploymentArtifactRefDto }) artifactVersion!: DeploymentArtifactRefDto;
  @ApiProperty({ type: [TrafficRuleDto] }) traffic!: TrafficRuleDto[];
}

/** `DeploymentService.rollback`. */
export class DeploymentRolledBackDto {
  @ApiProperty({ example: '55001' }) rolledBackDeploymentId!: string;
  @ApiProperty({ example: '54990' }) activeDeploymentId!: string;
}

/** `DeploymentService.suspend`. */
export class DeploymentSuspendedDto {
  @ApiProperty({ example: '55001' }) deploymentId!: string;
  @ApiProperty({ example: 'SUSPENDED' }) status!: string;
}
