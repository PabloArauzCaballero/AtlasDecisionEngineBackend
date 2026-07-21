import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { CreateArtifactReferenceDto, UpdateArtifactReferenceDto } from './nested-tree.dto';
import { NestedTreeService } from './nested-tree.service';

/**
 * Nested decision trees (Fase 7). A reference is created against the PARENT artifact
 * VERSION it lives in (references, like the graph itself, are draft-editable state).
 * Manual creation is this REST API called from the UI; "creatable via JS and Python"
 * (per the product brief) means this same API called from JS/Python client code —
 * see docs/nested-decision-trees.md for both examples. There is no separate
 * language-specific creation path.
 */
@ApiTags('Nested Decision Trees')
@Controller('v1/artifact-versions/:versionId/references')
export class NestedTreeController {
  constructor(private readonly nestedTrees: NestedTreeService) {}

  @Post()
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  create(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('versionId') versionId: string,
    @Body() dto: CreateArtifactReferenceDto,
  ) {
    return this.nestedTrees.create(tenantId, parseBigIntId(versionId, 'versionId'), dto, principal);
  }

  @Get()
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR')
  list(@TenantId() tenantId: bigint, @Param('versionId') versionId: string) {
    return this.nestedTrees.list(tenantId, parseBigIntId(versionId, 'versionId'));
  }

  @Put(':referenceId')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  update(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('versionId') versionId: string,
    @Param('referenceId') referenceId: string,
    @Body() dto: UpdateArtifactReferenceDto,
  ) {
    return this.nestedTrees.update(
      tenantId,
      parseBigIntId(versionId, 'versionId'),
      parseBigIntId(referenceId, 'referenceId'),
      dto,
      principal,
    );
  }

  @Delete(':referenceId')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  remove(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('versionId') versionId: string,
    @Param('referenceId') referenceId: string,
  ) {
    return this.nestedTrees.delete(
      tenantId,
      parseBigIntId(versionId, 'versionId'),
      parseBigIntId(referenceId, 'referenceId'),
      principal,
    );
  }
}

@ApiTags('Nested Decision Trees')
@Controller('v1/artifacts/:artifactId/dependency-graph')
export class DependencyGraphController {
  constructor(private readonly nestedTrees: NestedTreeService) {}

  @Get()
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR')
  get(@TenantId() tenantId: bigint, @Param('artifactId') artifactId: string) {
    return this.nestedTrees.getDependencyGraph(tenantId, parseBigIntId(artifactId, 'artifactId'));
  }
}
