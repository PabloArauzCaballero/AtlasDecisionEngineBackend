import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { ApiArrayResponse, ApiEmptyOkResponse } from '../../common/http/pagination.dto';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { CreateArtifactReferenceDto, UpdateArtifactReferenceDto } from './nested-tree.dto';
import { ArtifactReferenceDto, DependencyGraphResponseDto } from './nested-tree.response.dto';
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
  @ApiOperation({ summary: 'Create a validated child-artifact reference' })
  @ApiCreatedResponse({ description: 'Referencia creada.', type: ArtifactReferenceDto })
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
  @ApiOperation({ summary: 'List references owned by an artifact version' })
  @ApiArrayResponse(
    'Referencias declaradas por la versión, ordenadas por nodeKey. Array desnudo: una versión está acotada y no se pagina.',
    ArtifactReferenceDto,
  )
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR')
  list(@TenantId() tenantId: bigint, @Param('versionId') versionId: string) {
    return this.nestedTrees.list(tenantId, parseBigIntId(versionId, 'versionId'));
  }

  @Put(':referenceId')
  @ApiOperation({ summary: 'Update mappings, timeout or error policy of a reference' })
  @ApiOkResponse({ description: 'Referencia actualizada.', type: ArtifactReferenceDto })
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
  @ApiOperation({ summary: 'Delete a reference from an editable parent version' })
  @ApiEmptyOkResponse('Referencia eliminada.')
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
  @ApiOperation({ summary: 'Get upstream and downstream artifact dependencies' })
  @ApiOkResponse({
    description: 'Dependencias y dependientes del artefacto, acotados por profundidad y aristas.',
    type: DependencyGraphResponseDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR')
  get(@TenantId() tenantId: bigint, @Param('artifactId') artifactId: string) {
    return this.nestedTrees.getDependencyGraph(tenantId, parseBigIntId(artifactId, 'artifactId'));
  }
}
