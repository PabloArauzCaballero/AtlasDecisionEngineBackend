import { ApiProperty } from '@nestjs/swagger';
import {
  ArtifactSummaryDto,
  ArtifactVersionStatusHistoryDto,
  ArtifactVersionSummaryDto,
  CompiledArtifactSummaryDto,
} from './artifact-catalog.dto';

export class ApprovalEvidenceDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: 'DOCUMENT' }) evidenceType!: string;
  @ApiProperty({ example: 's3://atlas-evidence/...' }) uri!: string;
  @ApiProperty({ example: 'a1b2c3...' }) checksum!: string;
  @ApiProperty({ nullable: true }) metadataJson!: Record<string, unknown> | null;
}

export class ApprovalDecisionDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: 'approver@atlas.local' }) decidedBy!: string;
  @ApiProperty({ example: 'APPROVED', enum: ['APPROVED', 'REJECTED'] }) decision!: string;
  @ApiProperty({ nullable: true }) comments!: string | null;
  @ApiProperty({ example: '2026-07-20T11:00:00.000Z' }) decidedAt!: string;
  @ApiProperty({ type: [ApprovalEvidenceDto] }) evidence!: ApprovalEvidenceDto[];
}

export class ApprovalStepDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: 1 }) stepOrder!: number;
  @ApiProperty({ example: 'RISK_APPROVER' }) requiredRole!: string;
  @ApiProperty({ example: 1 }) minApprovals!: number;
  @ApiProperty({ example: 'APPROVED', enum: ['PENDING', 'APPROVED', 'REJECTED'] }) status!: string;
  @ApiProperty({ example: true }) separationOfDuties!: boolean;
  @ApiProperty({ type: [ApprovalDecisionDto] }) decisions!: ApprovalDecisionDto[];
}

export class ApprovalRequestDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: 'STANDARD_APPROVAL' }) workflowCode!: string;
  @ApiProperty({ example: 'analyst@atlas.local' }) requestedBy!: string;
  @ApiProperty({ example: '2026-07-20T10:30:00.000Z' }) requestedAt!: string;
  @ApiProperty({ example: 'APPROVED', enum: ['IN_REVIEW', 'APPROVED', 'REJECTED'] })
  status!: string;
  @ApiProperty({ nullable: true }) dueAt!: string | null;
  @ApiProperty({ type: [ApprovalStepDto] }) steps!: ApprovalStepDto[];
}

/** `ArtifactCatalogService.getVersion`: gobierno completo de una versión. */
export class ArtifactVersionDetailDto extends ArtifactVersionSummaryDto {
  @ApiProperty({ type: ArtifactSummaryDto }) artifact!: ArtifactSummaryDto;
  @ApiProperty({ type: [CompiledArtifactSummaryDto] })
  compiledArtifacts!: CompiledArtifactSummaryDto[];
  @ApiProperty({ type: [ArtifactVersionStatusHistoryDto] })
  statusHistory!: ArtifactVersionStatusHistoryDto[];
  @ApiProperty({ type: [ApprovalRequestDto] }) approvalRequests!: ApprovalRequestDto[];
}

/** Registro creado por `VersionCloneService.cloneVersion`: la nueva versión DRAFT, sin relaciones cargadas. */
export class ArtifactVersionClonedDto extends ArtifactVersionSummaryDto {}

/** Devuelto por `updateVersionNotes` y por `replaceDraftGraph`: proyección mínima tras la escritura. */
export class VersionWriteResultDto {
  @ApiProperty({ example: '4001' }) id!: string;
  @ApiProperty({ example: 'DRAFT' }) status?: string;
  @ApiProperty({ example: 2 }) lockVersion?: number;
  @ApiProperty({ nullable: true }) canonicalChecksum?: string | null;
  @ApiProperty({
    nullable: true,
    description: 'Presente solo en la respuesta de `PATCH .../notes`.',
  })
  authoringNotes?: string | null;
}
