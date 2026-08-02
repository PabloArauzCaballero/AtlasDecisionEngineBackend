/** Role-separated API for environment discovery, publish, suspend, rollback and history. */
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import {
  DeployVersionDto,
  DeploymentListQueryDto,
  RollbackDeploymentDto,
  SuspendDeploymentDto,
} from './deployment.dto';
import { ApiArrayResponse, ApiPagedResponse } from '../../common/http/pagination.dto';
import {
  DeploymentEnvironmentDto,
  DeploymentListItemDto,
  DeploymentRolledBackDto,
  DeploymentSuspendedDto,
} from './deployment.response.dto';
import { DeploymentService } from './deployment.service';

@ApiTags('Decision Deployments')
@Controller('v1')
export class DeploymentController {
  constructor(private readonly deployments: DeploymentService) {}

  @Get('environments')
  @ApiOperation({ summary: 'List active decision environments' })
  @ApiArrayResponse(
    'Ambientes de despliegue. Array desnudo: catálogo cerrado, no se pagina.',
    DeploymentEnvironmentDto,
  )
  @Roles('PLATFORM_ADMIN', 'RISK_ANALYST', 'QA_ANALYST', 'AUDITOR')
  environments() {
    return this.deployments.listEnvironments();
  }

  @Post('artifact-versions/:versionId/deployments')
  @ApiOperation({ summary: 'Publish an approved compiled artifact version' })
  @Roles('PLATFORM_ADMIN')
  deploy(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('versionId') versionId: string,
    @Body() dto: DeployVersionDto,
  ) {
    return this.deployments.deploy(tenantId, parseBigIntId(versionId, 'versionId'), dto, principal);
  }

  @Post('deployments/:deploymentId/rollback')
  @ApiOperation({ summary: 'Rollback an active deployment to its predecessor' })
  @ApiCreatedResponse({
    description: 'Despliegue restaurado al predecesor.',
    type: DeploymentRolledBackDto,
  })
  @Roles('PLATFORM_ADMIN')
  rollback(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('deploymentId') deploymentId: string,
    @Body() dto: RollbackDeploymentDto,
  ) {
    return this.deployments.rollback(
      tenantId,
      parseBigIntId(deploymentId, 'deploymentId'),
      dto,
      principal,
    );
  }

  @Post('deployments/:deploymentId/suspend')
  @ApiOperation({ summary: 'Suspend a deployment and invalidate its runtime binding' })
  @ApiCreatedResponse({ description: 'Despliegue suspendido.', type: DeploymentSuspendedDto })
  @Roles('PLATFORM_ADMIN')
  suspend(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('deploymentId') deploymentId: string,
    @Body() dto: SuspendDeploymentDto,
  ) {
    return this.deployments.suspend(
      tenantId,
      parseBigIntId(deploymentId, 'deploymentId'),
      dto,
      principal,
    );
  }

  @Get('deployments')
  @ApiOperation({ summary: 'List deployment history with filters' })
  @ApiPagedResponse('Página del historial de despliegues.', DeploymentListItemDto)
  @Roles('PLATFORM_ADMIN', 'RISK_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR', 'OPERATIONS')
  list(@TenantId() tenantId: bigint, @Query() query: DeploymentListQueryDto) {
    return this.deployments.list(tenantId, query);
  }
}
