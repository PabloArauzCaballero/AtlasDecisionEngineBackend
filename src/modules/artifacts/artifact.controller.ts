import { Body, Controller, Get, Headers, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseBigIntId, parseIfMatch } from '../../common/http/id';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { ArtifactGraphReaderService } from './artifact-graph-reader.service';
import { ArtifactGraphWriterService } from './artifact-graph-writer.service';
import { ArtifactLifecycleService } from './artifact-lifecycle.service';
import { ArtifactService } from './artifact.service';
import {
  ArtifactListQueryDto,
  CloneVersionDto,
  CreateArtifactDto,
  ReplaceGraphDto,
} from './artifact.dto';

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
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  create(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: CreateArtifactDto,
  ) {
    return this.artifacts.create(tenantId, dto, principal);
  }

  @Get('artifacts')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR', 'OPERATIONS')
  list(@TenantId() tenantId: bigint, @Query() query: ArtifactListQueryDto) {
    return this.artifacts.list(tenantId, query);
  }

  @Get('artifacts/:artifactId')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR', 'OPERATIONS')
  get(@TenantId() tenantId: bigint, @Param('artifactId') artifactId: string) {
    return this.artifacts.get(tenantId, parseBigIntId(artifactId, 'artifactId'));
  }

  @Get('artifact-versions/:versionId')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR', 'OPERATIONS')
  getVersion(@TenantId() tenantId: bigint, @Param('versionId') versionId: string) {
    return this.artifacts.getVersion(tenantId, parseBigIntId(versionId, 'versionId'));
  }

  @Get('artifact-versions/:versionId/graph')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR')
  getGraph(@TenantId() tenantId: bigint, @Param('versionId') versionId: string) {
    return this.graphReader.loadSnapshot(tenantId, parseBigIntId(versionId, 'versionId'));
  }

  @Post('artifact-versions/:versionId/clone')
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

  @Post('artifact-versions/:versionId/validate')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST')
  validate(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('versionId') versionId: string,
  ) {
    return this.lifecycle.validate(tenantId, parseBigIntId(versionId, 'versionId'), principal);
  }

  @Post('artifact-versions/:versionId/compile')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST')
  compile(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('versionId') versionId: string,
  ) {
    return this.lifecycle.compile(tenantId, parseBigIntId(versionId, 'versionId'), principal);
  }

  @Post('artifact-versions/:versionId/validate-and-compile')
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
