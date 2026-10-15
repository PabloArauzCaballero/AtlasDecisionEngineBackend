import { ApiProperty } from '@nestjs/swagger';

// --- Listado (forma aplanada de ArtifactCatalogService.list) ---

export class ArtifactListItemDto {
  @ApiProperty({ example: '4000' }) id!: string;
  @ApiProperty({ example: 'CREDIT_LIMIT_V2' }) artifactCode!: string;
  @ApiProperty({ example: 'Credit limit assignment' }) name!: string;
  @ApiProperty({ example: 'DECISION_TREE' }) artifactType!: string;
  @ApiProperty({ example: 'risk-engineering' }) ownerTeam!: string;
  @ApiProperty({ example: '1.2.0', nullable: true }) latestVersion!: string | null;
  @ApiProperty({ example: 'DEPLOYED_TO_PROD', nullable: true }) latestStatus!: string | null;
  @ApiProperty({
    example: 'PROD',
    nullable: true,
    description:
      'Derivado de `latestStatus` (`DEPLOYED_TO_<AMBIENTE>`); `null` si no está desplegado.',
  })
  environmentCode!: string | null;
  @ApiProperty({ example: '2026-07-20T10:00:00.000Z', nullable: true }) lastValidatedAt!:
    string | null;
}

// --- Entidades base ---

export class ArtifactVersionStatusHistoryDto {
  @ApiProperty({ example: '90001' }) id!: string;
  @ApiProperty({ example: 'DRAFT', nullable: true }) fromStatus!: string | null;
  @ApiProperty({ example: 'VALIDATED' }) toStatus!: string;
  @ApiProperty({ example: 'analyst@atlas.local' }) changedBy!: string;
  @ApiProperty({ example: '2026-07-20T10:00:00.000Z' }) changedAt!: string;
  @ApiProperty({ example: 'Graph validation passed', nullable: true }) reason!: string | null;
}

export class CompiledArtifactSummaryDto {
  @ApiProperty({ example: '77001' }) id!: string;
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
  @ApiProperty({ example: '1.4.2' }) compilerVersion!: string;
  @ApiProperty({ example: '1.2' }) runtimeSchemaVersion!: string;
  @ApiProperty({ description: 'Payload ejecutable congelado; ver `CompiledDecisionArtifact`.' })
  compiledPayloadJson!: Record<string, unknown>;
  @ApiProperty({ example: 'c3d4e5f6...' }) compiledChecksum!: string;
  @ApiProperty({ example: 'SUCCESS', enum: ['SUCCESS', 'FAILED'] }) compileStatus!: string;
  @ApiProperty({ example: '2026-07-20T10:05:00.000Z' }) compiledAt!: string;
}

export class ArtifactSummaryDto {
  @ApiProperty({ example: '4000' }) id!: string;
  @ApiProperty({ example: '1200' }) tenantId!: string;
  @ApiProperty({ example: 'CREDIT_LIMIT_V2' }) artifactCode!: string;
  @ApiProperty({ example: 'DECISION_TREE' }) artifactType!: string;
  @ApiProperty({ example: 'Credit limit assignment' }) name!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ example: 'risk-engineering' }) ownerTeam!: string;
  @ApiProperty({ example: 'Assign the initial revolving credit limit' }) businessPurpose!: string;
  @ApiProperty({ example: 'CREDIT_RISK' }) riskDomain!: string;
  @ApiProperty({ example: true }) isActive!: boolean;
  @ApiProperty({ example: '2026-01-10T09:00:00.000Z' }) createdAt!: string;
  @ApiProperty({ example: '2026-07-20T10:00:00.000Z' }) updatedAt!: string;
}

export class DeploymentEnvironmentDto {
  @ApiProperty({ example: '2' }) id!: string;
  @ApiProperty({ example: 'PROD' }) code!: string;
  @ApiProperty({ example: 'Production' }) name!: string;
  @ApiProperty({ example: 'PRODUCTION' }) environmentType!: string;
  @ApiProperty({ example: 'ACTIVE' }) status!: string;
  @ApiProperty({ example: true }) isProduction!: boolean;
  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' }) createdAt!: string;
}

export class VersionDeploymentDto {
  @ApiProperty({ example: '55001' }) id!: string;
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
  @ApiProperty({ example: '77001' }) compiledArtifactId!: string;
  @ApiProperty({ example: '2' }) environmentId!: string;
  @ApiProperty({ example: 'ROLLING' }) deploymentMode!: string;
  @ApiProperty({ example: 'ACTIVE', enum: ['PENDING', 'ACTIVE', 'SUSPENDED', 'ROLLED_BACK'] })
  deploymentStatus!: string;
  @ApiProperty({ example: '2026-07-20T10:10:00.000Z' }) effectiveFrom!: string;
  @ApiProperty({ nullable: true }) effectiveTo!: string | null;
  @ApiProperty({ example: true }) isActive!: boolean;
  @ApiProperty({ nullable: true }) previousDeploymentId!: string | null;
  @ApiProperty({ nullable: true }) rollbackOfDeploymentId!: string | null;
  @ApiProperty({ example: 'analyst@atlas.local' }) deployedBy!: string;
  @ApiProperty({ example: '2026-07-20T10:10:00.000Z' }) deployedAt!: string;
  @ApiProperty({ type: DeploymentEnvironmentDto }) environment!: DeploymentEnvironmentDto;
}

export class ArtifactVersionSummaryDto {
  @ApiProperty({ example: '4001' }) id!: string;
  @ApiProperty({ example: '4000' }) artifactId!: string;
  @ApiProperty({ example: 1 }) versionNumber!: number;
  @ApiProperty({ example: 'DRAFT' }) status!: string;
  @ApiProperty({ nullable: true }) sourceVersionId!: string | null;
  @ApiProperty({ example: '0.1.0' }) semanticVersion!: string;
  @ApiProperty({ nullable: true }) changeSummary!: string | null;
  @ApiProperty({ nullable: true }) authoringNotes!: string | null;
  @ApiProperty({ nullable: true }) canonicalChecksum!: string | null;
  @ApiProperty({ example: 1 }) lockVersion!: number;
  @ApiProperty({ example: 'analyst@atlas.local' }) createdBy!: string;
  @ApiProperty({ example: '2026-01-10T09:00:00.000Z' }) createdAt!: string;
  @ApiProperty({ nullable: true }) submittedAt!: string | null;
  @ApiProperty({ nullable: true }) approvedAt!: string | null;
  @ApiProperty({ nullable: true }) retiredAt!: string | null;
}

/** `ArtifactCatalogService.get`: artefacto con todas sus versiones y su despliegue/compilación. */
export class ArtifactDetailVersionDto extends ArtifactVersionSummaryDto {
  @ApiProperty({ type: [CompiledArtifactSummaryDto] })
  compiledArtifacts!: CompiledArtifactSummaryDto[];
  @ApiProperty({ type: [VersionDeploymentDto] }) deployments!: VersionDeploymentDto[];
}

export class ArtifactDetailDto extends ArtifactSummaryDto {
  @ApiProperty({ type: [ArtifactDetailVersionDto] }) versions!: ArtifactDetailVersionDto[];
}

/** `ArtifactCatalogService.create`: artefacto recién creado con su primera versión DRAFT. */
export class ArtifactCreatedDto extends ArtifactSummaryDto {
  @ApiProperty({ type: [ArtifactVersionSummaryDto] }) versions!: ArtifactVersionSummaryDto[];
}
