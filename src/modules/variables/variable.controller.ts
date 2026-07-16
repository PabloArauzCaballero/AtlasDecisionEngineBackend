import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import {
  CurrentPrincipal,
  Roles,
  TenantId,
} from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import {
  CreateReasonCodeDto,
  CreateVariableDefinitionDto,
  CreateVariableVersionDto,
  ReasonCodeListQueryDto,
  VariableListQueryDto,
} from './variable.dto';
import { VariableService } from './variable.service';

@ApiTags('Variable Catalog')
@Controller('v1')
export class VariableController {
  constructor(private readonly variables: VariableService) {}

  @Post('variables')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'PLATFORM_ADMIN')
  create(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: CreateVariableDefinitionDto,
  ) {
    return this.variables.createDefinition(tenantId, dto, principal);
  }

  @Get('variables')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR')
  list(@TenantId() tenantId: bigint, @Query() query: VariableListQueryDto) {
    return this.variables.list(tenantId, query);
  }

  @Get('variables/:definitionId')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR')
  get(@TenantId() tenantId: bigint, @Param('definitionId') definitionId: string) {
    return this.variables.get(tenantId, parseBigIntId(definitionId, 'definitionId'));
  }

  @Post('variables/:definitionId/versions')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'PLATFORM_ADMIN')
  createVersion(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('definitionId') definitionId: string,
    @Body() dto: CreateVariableVersionDto,
  ) {
    return this.variables.createVersion(
      tenantId,
      parseBigIntId(definitionId, 'definitionId'),
      dto,
      principal,
    );
  }

  @Post('reason-codes')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE')
  createReason(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: CreateReasonCodeDto,
  ) {
    return this.variables.createReasonCode(tenantId, dto, principal);
  }

  @Get('reason-codes')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR', 'OPERATIONS')
  listReasons(@TenantId() tenantId: bigint, @Query() query: ReasonCodeListQueryDto) {
    return this.variables.listReasonCodes(tenantId, query);
  }
}
