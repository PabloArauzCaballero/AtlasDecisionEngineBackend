/** API for governed variable/reason catalogs with separate author and reader roles. */
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPagedResponse } from '../../common/http/pagination.dto';
import { ReasonCodeCreatedDto, VariableDependenciesDto } from './variable.response.dto';
import { parseBigIntId } from '../../common/http/id';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import {
  CreateReasonCodeDto,
  CreateVariableDefinitionDto,
  CreateVariableVersionDto,
  ReasonCodeListQueryDto,
  ValidateVariableContractDto,
  VariableListQueryDto,
} from './variable.dto';
import { VariableContractService } from './variable-contract.service';
import { VariableService } from './variable.service';

@ApiTags('Variable Catalog')
@Controller('v1')
export class VariableController {
  constructor(
    private readonly variables: VariableService,
    private readonly contracts: VariableContractService,
  ) {}

  @Post('variables/validate-contract')
  @ApiOperation({
    summary: 'Validar un contrato de variable ANTES de guardarlo',
    description:
      'Comprueba la coherencia de las restricciones y ejecuta los ejemplos declarados. Una versión creada es inmutable, así que este paso evita publicar un contrato roto.',
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'PLATFORM_ADMIN')
  validateContract(@Body() dto: ValidateVariableContractDto) {
    return this.contracts.validateContract(dto);
  }

  @Post('variables/:definitionId/compatibility')
  @ApiOperation({
    summary: 'Comparar un contrato candidato con la última versión',
    description:
      'Clasifica el cambio como COMPATIBLE, WIDENING o BREAKING y detalla qué se estrecha.',
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR')
  compatibility(
    @TenantId() tenantId: bigint,
    @Param('definitionId') definitionId: string,
    @Body() dto: ValidateVariableContractDto,
  ) {
    return this.contracts.checkCompatibility(
      tenantId,
      parseBigIntId(definitionId, 'definitionId'),
      dto,
    );
  }

  @Get('variables/:definitionId/dependencies')
  @ApiOperation({ summary: 'Artefactos y versiones que usan esta variable' })
  @ApiOkResponse({
    description: 'Artefactos y versiones que dependen de esta variable.',
    type: VariableDependenciesDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR')
  dependencies(@TenantId() tenantId: bigint, @Param('definitionId') definitionId: string) {
    return this.variables.dependencies(tenantId, parseBigIntId(definitionId, 'definitionId'));
  }

  @Post('variables')
  @ApiOperation({ summary: 'Create a governed variable definition and initial version' })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'PLATFORM_ADMIN')
  create(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: CreateVariableDefinitionDto,
  ) {
    return this.variables.createDefinition(tenantId, dto, principal);
  }

  @Get('variables')
  @ApiOperation({ summary: 'List variable definitions with active versions' })
  @ApiPagedResponse('Página de definiciones de variable con su versión activa.')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR')
  list(@TenantId() tenantId: bigint, @Query() query: VariableListQueryDto) {
    return this.variables.list(tenantId, query);
  }

  @Get('variables/:definitionId')
  @ApiOperation({ summary: 'Get a variable definition and complete version history' })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR')
  get(@TenantId() tenantId: bigint, @Param('definitionId') definitionId: string) {
    return this.variables.get(tenantId, parseBigIntId(definitionId, 'definitionId'));
  }

  @Post('variables/:definitionId/versions')
  @ApiOperation({ summary: 'Create a new immutable variable version' })
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
  @ApiOperation({ summary: 'Create a governed explanation reason code' })
  @ApiCreatedResponse({ description: 'Código de razón creado.', type: ReasonCodeCreatedDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE')
  createReason(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: CreateReasonCodeDto,
  ) {
    return this.variables.createReasonCode(tenantId, dto, principal);
  }

  @Get('reason-codes')
  @ApiOperation({ summary: 'List reason codes with filters and pagination' })
  @ApiPagedResponse('Página de códigos de razón del catálogo.')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR', 'OPERATIONS')
  listReasons(@TenantId() tenantId: bigint, @Query() query: ReasonCodeListQueryDto) {
    return this.variables.listReasonCodes(tenantId, query);
  }
}
