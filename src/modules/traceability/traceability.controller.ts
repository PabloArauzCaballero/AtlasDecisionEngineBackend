import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import { ApiPagedResponse } from '../../common/http/pagination.dto';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import {
  CreateBusinessObjectiveDto,
  LinkPolicyArtifactDto,
  LinkPolicyTestSuiteDto,
  ObjectiveListQueryDto,
} from './traceability.dto';
import {
  BusinessObjectiveCreatedDto,
  BusinessObjectiveDetailDto,
  BusinessObjectiveListItemDto,
  CoverageMatrixDto,
  PolicyArtifactLinkCreatedDto,
  PolicyTestLinkCreatedDto,
} from './traceability.response.dto';
import { TraceabilityService } from './traceability.service';

@ApiTags('Requirements Traceability')
@Controller('v1/traceability')
export class TraceabilityController {
  constructor(private readonly traceability: TraceabilityService) {}

  @Post('objectives')
  @ApiOperation({ summary: 'Create a business objective and its policy requirements' })
  @ApiCreatedResponse({
    description: 'Objetivo creado con sus políticas.',
    type: BusinessObjectiveCreatedDto,
  })
  @Roles('RISK_ANALYST', 'COMPLIANCE')
  create(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: CreateBusinessObjectiveDto,
  ) {
    return this.traceability.createObjective(tenantId, dto, principal);
  }

  @Get('objectives')
  @ApiOperation({ summary: 'List business objectives and policies' })
  @ApiPagedResponse(
    'Página de objetivos de negocio con sus políticas.',
    BusinessObjectiveListItemDto,
  )
  @Roles('RISK_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR')
  list(@TenantId() tenantId: bigint, @Query() query: ObjectiveListQueryDto) {
    return this.traceability.list(tenantId, query);
  }

  @Get('objectives/:objectiveId')
  @ApiOperation({ summary: 'Get one objective with linked evidence' })
  @ApiOkResponse({
    description: 'Objetivo con su evidencia enlazada.',
    type: BusinessObjectiveDetailDto,
  })
  @Roles('RISK_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR')
  getObjective(@TenantId() tenantId: bigint, @Param('objectiveId') objectiveId: string) {
    return this.traceability.getObjective(tenantId, parseBigIntId(objectiveId, 'objectiveId'));
  }

  @Get('coverage-matrix')
  @ApiOperation({ summary: 'Compute objective-to-policy evidence coverage' })
  @ApiOkResponse({
    description: 'Matriz de cobertura objetivo × política.',
    type: CoverageMatrixDto,
  })
  @Roles('RISK_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR')
  coverageMatrix(@TenantId() tenantId: bigint) {
    return this.traceability.coverageMatrix(tenantId);
  }

  @Post('policies/:policyId/artifacts')
  @ApiOperation({ summary: 'Link a policy requirement to an artifact version' })
  @ApiCreatedResponse({ description: 'Enlace creado.', type: PolicyArtifactLinkCreatedDto })
  @Roles('RISK_ANALYST', 'COMPLIANCE')
  linkArtifact(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('policyId') policyId: string,
    @Body() dto: LinkPolicyArtifactDto,
  ) {
    return this.traceability.linkArtifact(
      tenantId,
      parseBigIntId(policyId, 'policyId'),
      dto,
      principal,
    );
  }

  @Post('policies/:policyId/test-suites')
  @ApiOperation({ summary: 'Link a policy requirement to a test suite' })
  @ApiCreatedResponse({ description: 'Enlace creado.', type: PolicyTestLinkCreatedDto })
  @Roles('RISK_ANALYST', 'QA_ANALYST', 'COMPLIANCE')
  linkTest(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('policyId') policyId: string,
    @Body() dto: LinkPolicyTestSuiteDto,
  ) {
    return this.traceability.linkTestSuite(
      tenantId,
      parseBigIntId(policyId, 'policyId'),
      dto,
      principal,
    );
  }
}
