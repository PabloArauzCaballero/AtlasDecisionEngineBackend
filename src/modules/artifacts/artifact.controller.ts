import { Body, Controller, Get, Headers, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { parseBigIntId, parseIfMatch } from '../../common/http/id';
import { ApiPagedResponse } from '../../common/http/pagination.dto';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import { ArtifactGraphReaderService } from './artifact-graph-reader.service';
import { ArtifactGraphWriterService } from './artifact-graph-writer.service';
import { ArtifactLifecycleService } from './artifact-lifecycle.service';
import { ArtifactService } from './artifact.service';
import {
  ArtifactListQueryDto,
  CloneVersionDto,
  CreateArtifactDto,
  ProcessingBasisDto,
  ReplaceGraphDto,
  UpdateVersionNotesDto,
} from './artifact.dto';
import {
  ArtifactCreatedDto,
  ArtifactDetailDto,
  ArtifactGraphSnapshotDto,
  ArtifactListItemDto,
  ArtifactVersionClonedDto,
  ArtifactVersionDetailDto,
  ArtifactVersionDiffDto,
  CompiledArtifactSummaryDto,
  GraphValidationReportDto,
  ProcessingBasisResultDto,
  ValidateAndCompileResultDto,
  VersionWriteResultDto,
} from './artifact.response.dto';

@ApiTags('Decision Artifacts')
@Controller('v1')
export class ArtifactController {
  constructor(
    private readonly artifacts: ArtifactService,
    private readonly graphReader: ArtifactGraphReaderService,
    private readonly graphWriter: ArtifactGraphWriterService,
    private readonly lifecycle: ArtifactLifecycleService,
  ) {}

  @Post('artifacts')
  @ApiOperation({ summary: 'Create an artifact with its first editable version' })
  @ApiCreatedResponse({
    description: 'Artefacto creado con su primera versión DRAFT.',
    type: ArtifactCreatedDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  create(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: CreateArtifactDto,
  ) {
    return this.artifacts.create(tenantId, dto, principal);
  }

  @Get('artifacts')
  @ApiOperation({ summary: 'List decision artifacts with filters and pagination' })
  @ApiPagedResponse('Página de artefactos de decisión.', ArtifactListItemDto)
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR', 'OPERATIONS')
  list(@TenantId() tenantId: bigint, @Query() query: ArtifactListQueryDto) {
    return this.artifacts.list(tenantId, query);
  }

  @Get('artifacts/:artifactId')
  @ApiOperation({ summary: 'Get an artifact and its version history' })
  @ApiOkResponse({
    description: 'Artefacto con el historial completo de sus versiones.',
    type: ArtifactDetailDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR', 'OPERATIONS')
  get(@TenantId() tenantId: bigint, @Param('artifactId') artifactId: string) {
    return this.artifacts.get(tenantId, parseBigIntId(artifactId, 'artifactId'));
  }

  @Get('artifact-versions/:versionId')
  @ApiOperation({ summary: 'Get one artifact version and governance state' })
  @ApiOkResponse({
    description: 'Versión con su estado de gobierno: compilaciones, historial y aprobaciones.',
    type: ArtifactVersionDetailDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR', 'OPERATIONS')
  getVersion(@TenantId() tenantId: bigint, @Param('versionId') versionId: string) {
    return this.artifacts.getVersion(tenantId, parseBigIntId(versionId, 'versionId'));
  }

  @Get('artifact-versions/:versionId/graph')
  @ApiOperation({ summary: 'Load the complete authoring graph snapshot' })
  @ApiOkResponse({
    description: 'Snapshot completo del grafo de autoría.',
    type: ArtifactGraphSnapshotDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR')
  getGraph(@TenantId() tenantId: bigint, @Param('versionId') versionId: string) {
    return this.graphReader.loadSnapshot(tenantId, parseBigIntId(versionId, 'versionId'));
  }

  @Post('artifact-versions/:versionId/clone')
  @ApiOperation({ summary: 'Clone an immutable version into a new draft' })
  @ApiCreatedResponse({
    description: 'Nueva versión DRAFT clonada.',
    type: ArtifactVersionClonedDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  clone(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('versionId') versionId: string,
    @Body() dto: CloneVersionDto,
  ) {
    return this.artifacts.cloneVersion(
      tenantId,
      parseBigIntId(versionId, 'versionId'),
      dto,
      principal,
    );
  }

  @Put('artifact-versions/:versionId/graph')
  @ApiOperation({ summary: 'Atomically replace a draft graph using optimistic locking' })
  @ApiOkResponse({
    description: 'Grafo reemplazado; proyección mínima tras la escritura.',
    type: VersionWriteResultDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  replaceGraph(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('versionId') versionId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() dto: ReplaceGraphDto,
  ) {
    return this.graphWriter.replaceDraftGraph(
      tenantId,
      parseBigIntId(versionId, 'versionId'),
      parseIfMatch(ifMatch),
      dto,
      principal,
    );
  }

  @Patch('artifact-versions/:versionId/notes')
  @ApiOperation({ summary: 'Update non-executable authoring notes on an editable version' })
  @ApiOkResponse({ description: 'Notas actualizadas.', type: VersionWriteResultDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  updateNotes(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('versionId') versionId: string,
    @Body() dto: UpdateVersionNotesDto,
  ) {
    return this.artifacts.updateVersionNotes(
      tenantId,
      parseBigIntId(versionId, 'versionId'),
      dto.notes ?? null,
      principal,
    );
  }

  /**
   * Finalidad y base legal del tratamiento (LGPD arts. 6 I, 7 y 11).
   *
   * Es requisito para publicar una versión que consuma una variable de categoría especial:
   * el validador de grafo la rechaza mientras no esté declarada.
   */
  @Patch('artifact-versions/:versionId/processing-basis')
  @ApiOperation({ summary: 'Declare the processing purpose and legal basis of a version' })
  @ApiOkResponse({
    description: 'Finalidad y base legal actualizadas.',
    type: ProcessingBasisResultDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE')
  updateProcessingBasis(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('versionId') versionId: string,
    @Body() dto: ProcessingBasisDto,
  ) {
    return this.artifacts.updateProcessingBasis(
      tenantId,
      parseBigIntId(versionId, 'versionId'),
      dto,
      principal,
    );
  }

  @Post('artifact-versions/:versionId/validate')
  @ApiOperation({ summary: 'Validate graph structure, expressions and determinism' })
  @ApiCreatedResponse({ description: 'Informe de validación.', type: GraphValidationReportDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST')
  validate(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('versionId') versionId: string,
  ) {
    return this.lifecycle.validate(tenantId, parseBigIntId(versionId, 'versionId'), principal);
  }

  @Post('artifact-versions/:versionId/compile')
  @ApiOperation({ summary: 'Compile a valid version into an immutable runtime payload' })
  @ApiCreatedResponse({ description: 'Artefacto compilado.', type: CompiledArtifactSummaryDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST')
  compile(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('versionId') versionId: string,
  ) {
    return this.lifecycle.compile(tenantId, parseBigIntId(versionId, 'versionId'), principal);
  }

  @Post('artifact-versions/:versionId/validate-and-compile')
  @ApiOperation({ summary: 'Validate and compile a version in one command' })
  @ApiCreatedResponse({
    description: 'Resultado combinado de validación y compilación.',
    type: ValidateAndCompileResultDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST')
  validateAndCompile(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('versionId') versionId: string,
  ) {
    return this.lifecycle.validateAndCompile(
      tenantId,
      parseBigIntId(versionId, 'versionId'),
      principal,
    );
  }

  @Get('artifact-versions/:leftVersionId/diff/:rightVersionId')
  @ApiOperation({ summary: 'Compare two version snapshots canonically' })
  @ApiOkResponse({
    description: 'Diferencias por entidad entre ambas versiones.',
    type: ArtifactVersionDiffDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR')
  diff(
    @TenantId() tenantId: bigint,
    @Param('leftVersionId') leftVersionId: string,
    @Param('rightVersionId') rightVersionId: string,
  ) {
    return this.lifecycle.diff(
      tenantId,
      parseBigIntId(leftVersionId, 'leftVersionId'),
      parseBigIntId(rightVersionId, 'rightVersionId'),
    );
  }
}
