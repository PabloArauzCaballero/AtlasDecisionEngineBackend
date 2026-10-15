import { ApiProperty } from '@nestjs/swagger';
import { CompiledArtifactSummaryDto } from './artifact-catalog.dto';
import { GraphActionDto, GraphConditionDto, VariableContractDto } from './graph-contract.dto';
import { ArtifactGraphSnapshotDto, GraphEdgeDto, GraphNodeDto } from './graph-structure.dto';

// --- Validación, compilación, diff ---

export class ValidationIssueDto {
  @ApiProperty({ example: 'UNREACHABLE_NODE' }) code!: string;
  @ApiProperty({ example: 'Node CHECK_BUREAU is not reachable from START' }) message!: string;
  @ApiProperty({ enum: ['ERROR', 'WARNING'] }) severity!: string;
  @ApiProperty({
    required: false,
    enum: ['VERSION', 'VARIABLE', 'NODE', 'EDGE', 'CONDITION', 'ACTION'],
  })
  entityType?: string;
  @ApiProperty({ required: false, example: 'CHECK_BUREAU' }) entityKey?: string;
  @ApiProperty({ required: false }) path?: string;
}

/** `GraphValidationReport` — devuelto por `validate` y embebido en `validate-and-compile`. */
export class GraphValidationReportDto {
  @ApiProperty({ example: true }) valid!: boolean;
  @ApiProperty({ type: [ValidationIssueDto] }) errors!: ValidationIssueDto[];
  @ApiProperty({ type: [ValidationIssueDto] }) warnings!: ValidationIssueDto[];
  @ApiProperty({
    example: {
      nodeCount: 12,
      edgeCount: 14,
      reachableNodeCount: 12,
      terminalNodeCount: 3,
      terminalPathCount: 5,
    },
  })
  metrics!: {
    nodeCount: number;
    edgeCount: number;
    reachableNodeCount: number;
    terminalNodeCount: number;
    terminalPathCount: number;
  };
  @ApiProperty({
    type: ArtifactGraphSnapshotDto,
    required: false,
    description: 'Presente solo cuando `valid` es cierto.',
  })
  canonicalAst?: ArtifactGraphSnapshotDto;
  @ApiProperty({
    required: false,
    example: 'c3d4e5f6...',
    description: 'Presente solo cuando `valid` es cierto.',
  })
  checksum?: string;
}

/** Respuesta de `POST .../validate-and-compile`: valida y, si es válido, compila en el mismo paso. */
export class ValidateAndCompileResultDto {
  @ApiProperty({ type: GraphValidationReportDto }) validation!: GraphValidationReportDto;
  @ApiProperty({
    type: CompiledArtifactSummaryDto,
    nullable: true,
    description: '`null` cuando la validación falló y por tanto no se llegó a compilar.',
  })
  compiledArtifact!: CompiledArtifactSummaryDto | null;
}

export class DiffEntryDto<T> {
  @ApiProperty({ type: 'array', items: {} }) added!: T[];
  @ApiProperty({ type: 'array', items: {} }) removed!: T[];
  @ApiProperty({
    type: 'array',
    items: { type: 'object', properties: { before: {}, after: {} } },
  })
  changed!: Array<{ before: T; after: T }>;
}

/** `ArtifactLifecycleService.diff`: comparación canónica entre dos versiones. */
export class ArtifactVersionDiffDto {
  @ApiProperty({ example: { versionId: '4001', checksum: 'c3d4...' } })
  left!: { versionId: string; checksum?: string | null };
  @ApiProperty({ example: { versionId: '4005', checksum: 'a1b2...' } })
  right!: { versionId: string; checksum?: string | null };
  @ApiProperty({ type: DiffEntryDto }) nodes!: DiffEntryDto<GraphNodeDto>;
  @ApiProperty({ type: DiffEntryDto }) edges!: DiffEntryDto<GraphEdgeDto>;
  @ApiProperty({ type: DiffEntryDto }) conditions!: DiffEntryDto<GraphConditionDto>;
  @ApiProperty({ type: DiffEntryDto }) actions!: DiffEntryDto<GraphActionDto>;
  @ApiProperty({ type: DiffEntryDto }) variables!: DiffEntryDto<VariableContractDto>;
}

/** `VersionAuthoringService.updateProcessingBasis`: finalidad y base legal declaradas de una versión. */
export class ProcessingBasisResultDto {
  @ApiProperty({ example: '4001' }) id!: string;
  @ApiProperty({
    nullable: true,
    example: 'Evaluación de riesgo para originación de crédito al consumo',
  })
  processingPurpose!: string | null;
  @ApiProperty({
    nullable: true,
    enum: [
      'CONSENT',
      'CONTRACT',
      'LEGAL_OBLIGATION',
      'REGULATORY_EXERCISE',
      'CREDIT_PROTECTION',
      'LEGITIMATE_INTEREST',
      'VITAL_INTEREST',
      'HEALTH_PROTECTION',
    ],
    example: 'CREDIT_PROTECTION',
  })
  legalBasis!: string | null;
  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    example: {
      onMissing: 'REVIEW',
      requirements: [{ purpose: 'credit_underwriting', acceptedBases: ['CREDIT_PROTECTION'] }],
    },
    description:
      'Base habilitante exigida por finalidad y qué hacer si falta. Nula = se deriva de ' +
      '`legalBasis` o de la política por defecto del motor para originación en producción.',
  })
  enablingBasisPolicy!: Record<string, unknown> | null;
}
