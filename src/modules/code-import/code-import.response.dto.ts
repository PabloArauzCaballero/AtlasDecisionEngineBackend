import { ApiProperty } from '@nestjs/swagger';

class LineIssueDto {
  @ApiProperty({ example: 'CONTRACT', enum: ['SYNTAX', 'CONTRACT', 'SECURITY', 'GRAPH'] })
  source!: string;
  @ApiProperty({ example: 'ERROR', enum: ['ERROR', 'WARNING'] }) severity!: string;
  @ApiProperty({ example: 12 }) line!: number;
  @ApiProperty({ required: false, example: 4 }) column?: number;
  @ApiProperty({ example: 'Output "approved_limit" is never assigned' }) message!: string;
  @ApiProperty({ example: 'OUTPUT_NEVER_ASSIGNED' }) code!: string;
}

class ContractVariableDto {
  @ApiProperty({ example: 'applicant_income' }) id!: string;
  @ApiProperty({ example: 'applicant_income' }) name!: string;
  @ApiProperty({
    example: 'NUMBER',
    enum: ['STRING', 'INTEGER', 'NUMBER', 'BOOLEAN', 'DATE', 'DATETIME', 'OBJECT', 'ARRAY'],
  })
  type!: string;
  @ApiProperty({ example: true }) required!: boolean;
  @ApiProperty({ nullable: true }) default?: unknown;
}

class MetadataContractDto {
  @ApiProperty({ example: '1' }) contractVersion!: string;
  @ApiProperty({ type: [ContractVariableDto] }) inputs!: ContractVariableDto[];
  @ApiProperty({ type: [ContractVariableDto] }) outputs!: ContractVariableDto[];
  @ApiProperty({ required: false, example: 'approved_limit' }) primaryOutputId?: string;
}

class CodeImportIrDto {
  @ApiProperty({ example: '1' }) irVersion!: string;
  @ApiProperty({ example: 'JAVASCRIPT', enum: ['JAVASCRIPT', 'PYTHON'] }) language!: string;
  @ApiProperty({ example: 'a1b2c3...' }) sourceChecksum!: string;
  @ApiProperty({ type: MetadataContractDto }) contract!: MetadataContractDto;
  @ApiProperty({ example: 'if (applicant_income > 5000) { ... }' }) scriptBody!: string;
  @ApiProperty({
    required: false,
    type: [Object],
    description: 'Ramas derivadas del if/elif/else; ausente si el código no es traducible a árbol.',
  })
  branches?: unknown[];
}

class GeneratedGraphDependencyDto {
  @ApiProperty({ example: 'applicant_income' }) variableCode!: string;
  @ApiProperty({ example: 'INPUT', enum: ['INPUT', 'OUTPUT', 'OUTPUT_PRIMARY'] })
  usageType!: string;
  @ApiProperty({ example: 'applicant_income' }) dependencyPath!: string;
  @ApiProperty({ example: 'NUMBER' }) dataType!: string;
  @ApiProperty({ example: true }) required!: boolean;
}

class GeneratedGraphNodeDto {
  @ApiProperty({ example: 'CHECK_INCOME' }) key!: string;
  @ApiProperty({ example: 'CONDITION' }) type!: string;
  @ApiProperty({ example: 'Check minimum income' }) label!: string;
  @ApiProperty() config!: Record<string, unknown>;
}

class GeneratedGraphEdgeDto {
  @ApiProperty({ example: 'CHECK_INCOME__TO__RESULT' }) key!: string;
  @ApiProperty({ example: 'CHECK_INCOME' }) from!: string;
  @ApiProperty({ example: 'RESULT' }) to!: string;
  @ApiProperty({ example: false }) default!: boolean;
  @ApiProperty({ required: false, example: 'HAS_SUFFICIENT_INCOME' }) conditionCode?: string;
}

class GeneratedGraphConditionDto {
  @ApiProperty({ example: 'HAS_SUFFICIENT_INCOME' }) code!: string;
  @ApiProperty({ example: 'Applicant has sufficient income' }) name!: string;
  @ApiProperty() expression!: unknown;
}

class GeneratedGraphPreviewDto {
  @ApiProperty({ type: [GeneratedGraphDependencyDto] })
  dependencies!: GeneratedGraphDependencyDto[];
  @ApiProperty({ type: [GeneratedGraphNodeDto] }) nodes!: GeneratedGraphNodeDto[];
  @ApiProperty({ type: [GeneratedGraphEdgeDto] }) edges!: GeneratedGraphEdgeDto[];
  @ApiProperty({ required: false, type: [GeneratedGraphConditionDto] })
  conditions?: GeneratedGraphConditionDto[];
}

/** `CodeImportService.analyze`. */
export class CodeImportAnalyzedDto {
  @ApiProperty({ example: '9001' }) id!: string;
  @ApiProperty({ type: CodeImportIrDto }) ir!: CodeImportIrDto;
  @ApiProperty({ type: [LineIssueDto] }) issues!: LineIssueDto[];
  @ApiProperty({ type: GeneratedGraphPreviewDto }) generatedGraph!: GeneratedGraphPreviewDto;
}

/** Forma real de `decision_code_import` — devuelta por `get` y `list`. */
export class CodeImportRecordDto {
  @ApiProperty({ example: '9001' }) id!: string;
  @ApiProperty({ example: '1200' }) tenantId!: string;
  @ApiProperty({ nullable: true, example: '4000' }) artifactId!: string | null;
  @ApiProperty({ nullable: true, example: '4001' }) artifactVersionId!: string | null;
  @ApiProperty({ example: 'JAVASCRIPT' }) language!: string;
  @ApiProperty({ example: 'if (applicant_income > 5000) { ... }' }) sourceCode!: string;
  @ApiProperty({ example: 'a1b2c3...' }) sourceChecksum!: string;
  @ApiProperty({ example: '1' }) contractVersion!: string;
  @ApiProperty({ type: MetadataContractDto }) contractJson!: MetadataContractDto;
  @ApiProperty({ type: CodeImportIrDto }) irJson!: CodeImportIrDto;
  @ApiProperty({ type: [LineIssueDto] }) issuesJson!: LineIssueDto[];
  @ApiProperty({ example: 'ANALYZED', enum: ['ANALYZED', 'DRAFT_SAVED', 'CONFIRMED', 'CANCELLED'] })
  status!: string;
  @ApiProperty({ example: 'analyst@atlas.local' }) createdBy!: string;
  @ApiProperty({ example: '2026-07-20T10:00:00.000Z' }) createdAt!: string;
  @ApiProperty({ example: '2026-07-20T10:00:00.000Z' }) updatedAt!: string;
}

class VersionWriteProjectionDto {
  @ApiProperty({ example: '4001' }) id!: string;
  @ApiProperty({ example: 'DRAFT' }) status!: string;
  @ApiProperty({ example: 2 }) lockVersion!: number;
  @ApiProperty({ nullable: true }) canonicalChecksum!: string | null;
}

/** `CodeImportService.saveDraft`. */
export class CodeImportDraftSavedDto {
  @ApiProperty({ type: CodeImportRecordDto }) record!: CodeImportRecordDto;
  @ApiProperty({ type: VersionWriteProjectionDto }) updatedVersion!: VersionWriteProjectionDto;
}

class ValidationIssueDto {
  @ApiProperty({ example: 'UNREACHABLE_NODE' }) code!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ enum: ['ERROR', 'WARNING'] }) severity!: string;
}

class GraphValidationReportSummaryDto {
  @ApiProperty({ example: true }) valid!: boolean;
  @ApiProperty({ type: [ValidationIssueDto] }) errors!: ValidationIssueDto[];
  @ApiProperty({ type: [ValidationIssueDto] }) warnings!: ValidationIssueDto[];
}

class CompiledArtifactRefDto {
  @ApiProperty({ example: '77001' }) id!: string;
  @ApiProperty({ example: 'c3d4e5f6...' }) compiledChecksum!: string;
  @ApiProperty({ example: 'SUCCESS' }) compileStatus!: string;
}

/** `CodeImportService.confirm`: guarda, valida y compila en un solo paso. */
export class CodeImportConfirmedDto {
  @ApiProperty({ type: CodeImportRecordDto }) record!: CodeImportRecordDto;
  @ApiProperty({ type: VersionWriteProjectionDto }) updatedVersion!: VersionWriteProjectionDto;
  @ApiProperty({ type: GraphValidationReportSummaryDto })
  validation!: GraphValidationReportSummaryDto;
  @ApiProperty({
    type: CompiledArtifactRefDto,
    nullable: true,
    description: '`null` cuando la validación falló y por tanto no se llegó a compilar.',
  })
  compiledArtifact!: CompiledArtifactRefDto | null;
}
