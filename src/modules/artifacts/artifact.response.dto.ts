import { ApiProperty } from '@nestjs/swagger';

// --- Listado (forma aplanada de ArtifactService.list) ---

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

class ArtifactSummaryDto {
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

class DeploymentEnvironmentDto {
  @ApiProperty({ example: '2' }) id!: string;
  @ApiProperty({ example: 'PROD' }) code!: string;
  @ApiProperty({ example: 'Production' }) name!: string;
  @ApiProperty({ example: 'PRODUCTION' }) environmentType!: string;
  @ApiProperty({ example: 'ACTIVE' }) status!: string;
  @ApiProperty({ example: true }) isProduction!: boolean;
  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' }) createdAt!: string;
}

class VersionDeploymentDto {
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

class ArtifactVersionSummaryDto {
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

/** `ArtifactService.get`: artefacto con todas sus versiones y su despliegue/compilación. */
export class ArtifactDetailVersionDto extends ArtifactVersionSummaryDto {
  @ApiProperty({ type: [CompiledArtifactSummaryDto] })
  compiledArtifacts!: CompiledArtifactSummaryDto[];
  @ApiProperty({ type: [VersionDeploymentDto] }) deployments!: VersionDeploymentDto[];
}

export class ArtifactDetailDto extends ArtifactSummaryDto {
  @ApiProperty({ type: [ArtifactDetailVersionDto] }) versions!: ArtifactDetailVersionDto[];
}

/** `ArtifactService.create`: artefacto recién creado con su primera versión DRAFT. */
export class ArtifactCreatedDto extends ArtifactSummaryDto {
  @ApiProperty({ type: [ArtifactVersionSummaryDto] }) versions!: ArtifactVersionSummaryDto[];
}

class ApprovalEvidenceDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: 'DOCUMENT' }) evidenceType!: string;
  @ApiProperty({ example: 's3://atlas-evidence/...' }) uri!: string;
  @ApiProperty({ example: 'a1b2c3...' }) checksum!: string;
  @ApiProperty({ nullable: true }) metadataJson!: Record<string, unknown> | null;
}

class ApprovalDecisionDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: 'approver@atlas.local' }) decidedBy!: string;
  @ApiProperty({ example: 'APPROVED', enum: ['APPROVED', 'REJECTED'] }) decision!: string;
  @ApiProperty({ nullable: true }) comments!: string | null;
  @ApiProperty({ example: '2026-07-20T11:00:00.000Z' }) decidedAt!: string;
  @ApiProperty({ type: [ApprovalEvidenceDto] }) evidence!: ApprovalEvidenceDto[];
}

class ApprovalStepDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: 1 }) stepOrder!: number;
  @ApiProperty({ example: 'RISK_APPROVER' }) requiredRole!: string;
  @ApiProperty({ example: 1 }) minApprovals!: number;
  @ApiProperty({ example: 'APPROVED', enum: ['PENDING', 'APPROVED', 'REJECTED'] }) status!: string;
  @ApiProperty({ example: true }) separationOfDuties!: boolean;
  @ApiProperty({ type: [ApprovalDecisionDto] }) decisions!: ApprovalDecisionDto[];
}

class ApprovalRequestDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: 'STANDARD_APPROVAL' }) workflowCode!: string;
  @ApiProperty({ example: 'analyst@atlas.local' }) requestedBy!: string;
  @ApiProperty({ example: '2026-07-20T10:30:00.000Z' }) requestedAt!: string;
  @ApiProperty({ example: 'APPROVED', enum: ['IN_REVIEW', 'APPROVED', 'REJECTED'] })
  status!: string;
  @ApiProperty({ nullable: true }) dueAt!: string | null;
  @ApiProperty({ type: [ApprovalStepDto] }) steps!: ApprovalStepDto[];
}

/** `ArtifactService.getVersion`: gobierno completo de una versión. */
export class ArtifactVersionDetailDto extends ArtifactVersionSummaryDto {
  @ApiProperty({ type: ArtifactSummaryDto }) artifact!: ArtifactSummaryDto;
  @ApiProperty({ type: [CompiledArtifactSummaryDto] })
  compiledArtifacts!: CompiledArtifactSummaryDto[];
  @ApiProperty({ type: [ArtifactVersionStatusHistoryDto] })
  statusHistory!: ArtifactVersionStatusHistoryDto[];
  @ApiProperty({ type: [ApprovalRequestDto] }) approvalRequests!: ApprovalRequestDto[];
}

/** Registro creado por `ArtifactService.cloneVersion`: la nueva versión DRAFT, sin relaciones cargadas. */
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

// --- Snapshot del grafo (ver src/modules/graph/graph.types.ts) ---

class VariableContractDto {
  @ApiProperty({ example: '3001' }) variableVersionId!: string;
  @ApiProperty({ nullable: true, example: 'INPUT' }) usageType?: string;
  @ApiProperty({ nullable: true }) dependencyPath?: string;
  @ApiProperty({ example: 'applicant_income' }) code!: string;
  @ApiProperty({ example: 3 }) version!: number;
  @ApiProperty({ example: 'DECIMAL' }) dataType!: string;
  @ApiProperty({ nullable: true, example: 'USD' }) unitCode?: string | null;
  @ApiProperty({ example: false }) nullable!: boolean;
  @ApiProperty({ nullable: true }) defaultValue?: unknown;
  @ApiProperty({ nullable: true }) validationSchema?: unknown;
  @ApiProperty({ nullable: true, description: 'Restricciones normalizadas (§1.1); autoritativas.' })
  constraints?: unknown;
  @ApiProperty({ nullable: true }) displayName?: string | null;
  @ApiProperty({ nullable: true }) description?: string | null;
  @ApiProperty({ nullable: true }) validationMessage?: string | null;
  @ApiProperty({ nullable: true }) exampleValid?: unknown;
  @ApiProperty({ nullable: true }) exampleInvalid?: unknown;
  @ApiProperty({ nullable: true, example: 'PROVIDER' }) expectedOrigin?: string;
  @ApiProperty({ nullable: true, example: '1.0' }) contractVersion?: string;
  @ApiProperty({ nullable: true, example: 'PII' }) sensitivityClass?: string;
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        ruleType: { type: 'string' },
        config: {},
        severity: { type: 'string' },
        errorCode: { type: 'string' },
      },
    },
  })
  validationRules!: Array<{
    ruleType: string;
    config: unknown;
    severity: string;
    errorCode: string;
  }>;
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        system: { type: 'string' },
        path: { type: 'string' },
        field: { type: 'string' },
        precedence: { type: 'integer' },
        freshnessSlaSeconds: { type: 'integer' },
        authoritative: { type: 'boolean' },
      },
    },
  })
  sources!: Array<{
    system: string;
    path: string;
    field: string;
    precedence: number;
    freshnessSlaSeconds: number;
    authoritative: boolean;
  }>;
  @ApiProperty({ example: true }) required!: boolean;
  @ApiProperty({ example: 'REJECT' }) fallbackPolicy!: string;
  @ApiProperty({ example: false }) sensitive!: boolean;
}

class IntermediateVariableSnapshotDto {
  @ApiProperty({ nullable: true }) id?: string;
  @ApiProperty({ example: 'debt_to_income_ratio' }) code!: string;
  @ApiProperty({ example: 'Debt-to-income ratio' }) name!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ example: 'DECIMAL' }) dataType!: string;
  @ApiProperty({ example: 'CALC_DTI' }) producerNodeKey!: string;
  @ApiProperty({ type: [String] }) consumerNodeKeys!: string[];
  @ApiProperty({ nullable: true }) initialValue?: unknown;
  @ApiProperty({ nullable: true }) constraints?: unknown;
  @ApiProperty({ example: false }) nullable!: boolean;
  @ApiProperty({ enum: ['SINGLE_WRITE', 'OVERWRITE', 'ACCUMULATE'] }) updatePolicy!: string;
  @ApiProperty({ nullable: true }) availabilityCondition?: unknown;
  @ApiProperty({ example: 'INTERNAL' }) sensitivityClass!: string;
  @ApiProperty({ enum: ['FULL', 'MASKED', 'REDACTED', 'EXCLUDED'] }) tracePolicy!: string;
}

class OutputContractFieldSnapshotDto {
  @ApiProperty({ nullable: true }) id?: string;
  @ApiProperty({ example: 'approved_limit' }) code!: string;
  @ApiProperty({ example: 'Approved credit limit' }) name!: string;
  @ApiProperty({ nullable: true }) description?: string | null;
  @ApiProperty({ enum: ['NODE', 'EXPRESSION', 'INTERMEDIATE', 'CONSTANT', 'REFERENCE'] })
  sourceKind!: string;
  @ApiProperty({ example: 'RESULT_NODE:limit' }) sourceRef!: string;
  @ApiProperty({ nullable: true }) valueMapping?: Record<string, unknown> | null;
  @ApiProperty({ type: [String] }) absenceReasons!: string[];
  @ApiProperty({
    type: [String],
    example: ['DTI_TOO_HIGH'],
    description: 'Motivos estructurados del catálogo que pueden devolverse con el campo (§4).',
  })
  reasonCodes!: string[];
  @ApiProperty({ nullable: true }) example?: unknown;
  @ApiProperty({ example: '1.0' }) contractVersion!: string;
  @ApiProperty({ example: 'INTERNAL' }) sensitivityClass!: string;
  @ApiProperty({ enum: ['FULL', 'MASKED', 'REDACTED', 'EXCLUDED'] }) tracePolicy!: string;
}

class GraphConditionDto {
  @ApiProperty({ nullable: true }) id?: string;
  @ApiProperty({ example: 'HAS_SUFFICIENT_INCOME' }) code!: string;
  @ApiProperty({ example: 'Applicant has sufficient income' }) name!: string;
  @ApiProperty({ example: 'JSON_LOGIC' }) expressionType!: string;
  @ApiProperty() expression!: unknown;
  @ApiProperty({ example: 'BLOCKING' }) severity!: string;
  @ApiProperty({ example: true }) reusable!: boolean;
}

class ReasonCodeDto {
  @ApiProperty({ nullable: true }) id?: string;
  @ApiProperty({ example: 'INSUFFICIENT_INCOME' }) code!: string;
  @ApiProperty({ example: 'ADVERSE_ACTION' }) category!: string;
  @ApiProperty({ example: 'Income does not meet the minimum required' }) publicMessage!: string;
  @ApiProperty({ example: 'DTI ratio 0.61 exceeds policy threshold 0.45' })
  internalMessage!: string;
  @ApiProperty({ example: 'HIGH' }) severity!: string;
  @ApiProperty({ example: true }) adverseAction!: boolean;
  @ApiProperty({ example: 1 }) priority!: number;
}

class GraphActionDto {
  @ApiProperty({ nullable: true }) id?: string;
  @ApiProperty({ example: 'DENY_APPLICATION' }) code!: string;
  @ApiProperty({ example: 'DECLINE' }) type!: string;
  @ApiProperty() payload!: Record<string, unknown>;
  @ApiProperty({ example: true }) terminal!: boolean;
  @ApiProperty({ type: [ReasonCodeDto] }) reasonCodes!: ReasonCodeDto[];
}

class CalculatedFieldCallSnapshotDto {
  @ApiProperty({ example: 'call_1' }) callKey!: string;
  @ApiProperty({ example: 'DEBT_TO_INCOME' }) fieldCode!: string;
  @ApiProperty({ example: '6001' }) calculatedFieldVersionId!: string;
  @ApiProperty({ example: 2 }) versionNumber!: number;
  @ApiProperty({ description: '`{ [inputId]: origen }`.' }) inputMapping!: Record<string, unknown>;
  @ApiProperty({
    example: { kind: 'INTERMEDIATE', code: 'debt_to_income_ratio' },
    description: '`{ kind: "INTERMEDIATE"|"OUTPUT", code }`.',
  })
  target!: { kind: string; code: string };
  @ApiProperty({
    description: 'Definición congelada, lista para ejecutarse sin tocar la base de datos.',
  })
  definition!: Record<string, unknown>;
}

class GraphNodeDto {
  @ApiProperty({ nullable: true }) id?: string;
  @ApiProperty({ example: 'CHECK_INCOME' }) key!: string;
  @ApiProperty({
    example: 'CONDITION',
    enum: [
      'START',
      'CONDITION',
      'SWITCH',
      'EXPRESSION',
      'DECISION_TABLE',
      'SCORE',
      'ACTION',
      'RESULT',
      'MANUAL_REVIEW',
      'END',
    ],
  })
  type!: string;
  @ApiProperty({ example: 'Check minimum income' }) label!: string;
  @ApiProperty() config!: Record<string, unknown>;
  @ApiProperty({ example: 320 }) x!: number;
  @ApiProperty({ example: 180 }) y!: number;
  @ApiProperty({ example: 2 }) order!: number;
  @ApiProperty({ example: false }) terminal!: boolean;
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        order: { type: 'integer' },
        expected: { type: 'boolean' },
      },
    },
  })
  conditions!: Array<{ code: string; order: number; expected: boolean }>;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', properties: { code: { type: 'string' }, order: { type: 'integer' } } },
  })
  actions!: Array<{ code: string; order: number }>;
  @ApiProperty({ type: [CalculatedFieldCallSnapshotDto], required: false })
  calculatedFieldCalls?: CalculatedFieldCallSnapshotDto[];
}

class GraphEdgeDto {
  @ApiProperty({ nullable: true }) id?: string;
  @ApiProperty({ example: 'CHECK_INCOME__TO__CHECK_BUREAU' }) key!: string;
  @ApiProperty({ example: 'CHECK_INCOME' }) from!: string;
  @ApiProperty({ example: 'CHECK_BUREAU' }) to!: string;
  @ApiProperty({ example: 'CONDITIONAL' }) type!: string;
  @ApiProperty({ example: 1 }) priority!: number;
  @ApiProperty({ example: false }) default!: boolean;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', properties: { code: { type: 'string' }, order: { type: 'integer' } } },
  })
  conditions!: Array<{ code: string; order: number }>;
}

/** `ArtifactGraphSnapshot` completo — ver `src/modules/graph/graph.types.ts`. */
export class ArtifactGraphSnapshotDto {
  @ApiProperty({
    example: {
      id: '4000',
      tenantId: '1200',
      code: 'CREDIT_LIMIT_V2',
      type: 'DECISION_TREE',
      name: 'Credit limit assignment',
      riskDomain: 'CREDIT_RISK',
    },
  })
  artifact!: {
    id: string;
    tenantId: string;
    code: string;
    type: string;
    name: string;
    riskDomain: string;
  };
  @ApiProperty({
    example: {
      id: '4001',
      number: 1,
      semanticVersion: '0.1.0',
      status: 'DRAFT',
      checksum: null,
      authoringNotes: null,
    },
  })
  version!: {
    id: string;
    number: number;
    semanticVersion: string;
    status: string;
    checksum?: string | null;
    authoringNotes?: string | null;
  };
  @ApiProperty({ type: [VariableContractDto] }) variables!: VariableContractDto[];
  @ApiProperty({ type: [IntermediateVariableSnapshotDto] })
  intermediates!: IntermediateVariableSnapshotDto[];
  @ApiProperty({ type: [OutputContractFieldSnapshotDto] })
  outputContract!: OutputContractFieldSnapshotDto[];
  @ApiProperty({ type: [GraphConditionDto] }) conditions!: GraphConditionDto[];
  @ApiProperty({ type: [GraphActionDto] }) actions!: GraphActionDto[];
  @ApiProperty({ type: [GraphNodeDto] }) nodes!: GraphNodeDto[];
  @ApiProperty({ type: [GraphEdgeDto] }) edges!: GraphEdgeDto[];
}

// --- Validación, compilación, diff ---

class ValidationIssueDto {
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

class DiffEntryDto<T> {
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
