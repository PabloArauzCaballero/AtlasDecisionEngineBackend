/** API de campos calculados reutilizables (§5, §6). */
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import { ApiPagedResponse } from '../../common/http/pagination.dto';
import {
  CalculatedFieldCreatedDto,
  CalculatedFieldDetailDto,
  CalculatedFieldListItemDto,
  CalculatedFieldPromotedDto,
  CalculatedFieldTestReportDto,
  CalculatedFieldTryRunDto,
  CalculatedFieldVersionCreatedDto,
  OperationCatalogDto,
} from './calculated-field.response.dto';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { OPERATIONS, OPERATION_CATEGORIES } from './operation-catalog';
import { MAX_EXECUTABLE_LINES } from './code-guard';
import {
  CalculatedFieldQueryDto,
  CreateCalculatedFieldDto,
  CreateCalculatedFieldVersionDto,
  PromoteCalculatedFieldVersionDto,
  TryCalculatedFieldDto,
} from './calculated-field.dto';
import { CalculatedFieldService } from './calculated-field.service';

@ApiTags('Calculated Fields')
@Controller('v1/calculated-fields')
export class CalculatedFieldController {
  constructor(private readonly fields: CalculatedFieldService) {}

  @Get('operations')
  @ApiOperation({ summary: 'Catálogo de operaciones del constructor visual' })
  @ApiOkResponse({
    description:
      'Catálogo CERRADO de operaciones visuales y el máximo de líneas ejecutables que el guardián de código admite.',
    type: OperationCatalogDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR', 'PLATFORM_ADMIN')
  operations() {
    return {
      categories: OPERATION_CATEGORIES,
      operations: OPERATIONS,
      maxExecutableLines: MAX_EXECUTABLE_LINES,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Listar campos calculados' })
  @ApiPagedResponse('Página de campos calculados del tenant.', CalculatedFieldListItemDto)
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR')
  list(@TenantId() tenantId: bigint, @Query() query: CalculatedFieldQueryDto) {
    return this.fields.list(tenantId, query);
  }

  @Get(':fieldId')
  @ApiOperation({ summary: 'Detalle de un campo calculado con todas sus versiones' })
  @ApiOkResponse({
    description: 'Campo con todas sus versiones y su evidencia de uso.',
    type: CalculatedFieldDetailDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR')
  get(@TenantId() tenantId: bigint, @Param('fieldId') fieldId: string) {
    return this.fields.get(tenantId, parseBigIntId(fieldId, 'fieldId'));
  }

  @Post()
  @ApiOperation({ summary: 'Crear un campo calculado' })
  @ApiCreatedResponse({ description: 'Campo creado.', type: CalculatedFieldCreatedDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'PLATFORM_ADMIN')
  create(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: CreateCalculatedFieldDto,
  ) {
    return this.fields.create(tenantId, dto, principal);
  }

  @Post(':fieldId/versions')
  @ApiOperation({
    summary: 'Crear una versión con su contrato de retorno e implementación',
    description:
      'El código JavaScript o Python no puede superar tres líneas ejecutables; los comentarios viajan aparte.',
  })
  @ApiCreatedResponse({
    description: 'Versión creada en DRAFT.',
    type: CalculatedFieldVersionCreatedDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'PLATFORM_ADMIN')
  createVersion(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('fieldId') fieldId: string,
    @Body() dto: CreateCalculatedFieldVersionDto,
  ) {
    return this.fields.createVersion(tenantId, parseBigIntId(fieldId, 'fieldId'), dto, principal);
  }

  @Post('versions/:versionId/promote')
  @ApiOperation({ summary: 'Promover una versión en su ciclo de gobierno' })
  @ApiCreatedResponse({ description: 'Versión promovida.', type: CalculatedFieldPromotedDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE', 'PLATFORM_ADMIN')
  promote(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('versionId') versionId: string,
    @Body() dto: PromoteCalculatedFieldVersionDto,
  ) {
    return this.fields.promote(tenantId, parseBigIntId(versionId, 'versionId'), dto, principal);
  }

  @Post('versions/:versionId/try')
  @ApiOperation({ summary: 'Ejecutar la versión con entradas de ejemplo, sin persistir nada' })
  @ApiCreatedResponse({
    description: 'Resultado de la ejecución de prueba.',
    type: CalculatedFieldTryRunDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'PLATFORM_ADMIN')
  tryRun(
    @TenantId() tenantId: bigint,
    @Param('versionId') versionId: string,
    @Body() dto: TryCalculatedFieldDto,
  ) {
    return this.fields.tryRun(tenantId, parseBigIntId(versionId, 'versionId'), dto.inputs);
  }

  @Post('versions/:versionId/test')
  @ApiOperation({ summary: 'Ejecutar los casos de prueba declarados de la versión' })
  @ApiCreatedResponse({
    description: 'Informe de los casos de prueba declarados.',
    type: CalculatedFieldTestReportDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'PLATFORM_ADMIN')
  test(@TenantId() tenantId: bigint, @Param('versionId') versionId: string) {
    return this.fields.runTestCases(tenantId, parseBigIntId(versionId, 'versionId'));
  }
}
