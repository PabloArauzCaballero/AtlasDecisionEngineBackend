import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Roles, TenantId } from '../../../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../../../common/security/security.types';
import { UpsertFinancialInstitutionDto } from './financial-institution.dto';
import {
  FinancialInstitutionDto,
  FinancialInstitutionSeedSummaryDto,
  FinancialInstitutionSummaryDto,
} from './financial-institution.response.dto';
import { FinancialInstitutionService } from './financial-institution.service';

/**
 * El padrón de entidades financieras bolivianas del worker de extractos.
 *
 * **Escribir aquí cambia qué documentos acepta el motor**, así que exige los
 * mismos roles que gobiernan los artefactos de decisión y no el de operación,
 * que puede ejecutar el worker pero no redefinir contra qué entidades reconoce.
 * Leer sí lo puede hacer quien opera: la pantalla de extractos necesita el
 * padrón para explicar por qué se rechazó un documento.
 */
@ApiTags('Workers · Entidades financieras')
@Controller('v1/workers/bank-statement/institutions')
export class FinancialInstitutionController {
  constructor(private readonly institutions: FinancialInstitutionService) {}

  @Get()
  @ApiOperation({ summary: 'Padrón de entidades financieras del tenant' })
  @ApiQuery({
    name: 'includeInactive',
    required: false,
    description:
      'Incluye las dadas de baja. Se pide de forma expresa porque una entidad inactiva ya no reconoce documentos y verla mezclada con las vigentes induce a creer que sí.',
  })
  @ApiOkResponse({
    description: 'Entidades ordenadas por tipo y código.',
    type: [FinancialInstitutionDto],
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS')
  list(@TenantId() tenantId: bigint, @Query('includeInactive') includeInactive?: string) {
    return this.institutions.list(tenantId, includeInactive === 'true');
  }

  @Get('summary')
  @ApiOperation({ summary: 'Estado del padrón y entidades que faltan respecto de la nómina ASFI' })
  @ApiOkResponse({
    description: 'Recuento por tipo y faltantes.',
    type: FinancialInstitutionSummaryDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS')
  summary(@TenantId() tenantId: bigint) {
    return this.institutions.summary(tenantId);
  }

  @Post()
  @ApiOperation({ summary: 'Da de alta una entidad en el padrón' })
  @ApiOkResponse({ description: 'Entidad escrita.', type: FinancialInstitutionDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  create(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: UpsertFinancialInstitutionDto,
  ) {
    return this.institutions.upsert(tenantId, dto, principal.id);
  }

  /**
   * El código va en la ruta y manda sobre el del cuerpo: si no, se podría enviar
   * uno distinto y reescribir la entidad equivocada desde el formulario de otra.
   */
  @Put(':code')
  @ApiOperation({ summary: 'Actualiza una entidad del padrón' })
  @ApiOkResponse({ description: 'Entidad actualizada.', type: FinancialInstitutionDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  update(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('code') code: string,
    @Body() dto: UpsertFinancialInstitutionDto,
  ) {
    return this.institutions.upsert(tenantId, { ...dto, code }, principal.id);
  }

  @Delete(':code')
  @ApiOperation({ summary: 'Da de baja una entidad (no se borra: las trazas la citan)' })
  @ApiOkResponse({ description: 'Entidad desactivada.', type: FinancialInstitutionDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  deactivate(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('code') code: string,
  ) {
    return this.institutions.deactivate(tenantId, code, principal.id);
  }

  @Post(':code/reactivate')
  @ApiOperation({ summary: 'Vuelve a poner en servicio una entidad dada de baja' })
  @ApiOkResponse({ description: 'Entidad reactivada.', type: FinancialInstitutionDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  reactivate(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('code') code: string,
  ) {
    return this.institutions.reactivate(tenantId, code, principal.id);
  }

  @Post('seed')
  @ApiOperation({
    summary: 'Inyecta las entidades de la nómina ASFI que falten en el padrón',
    description:
      'Sólo crea lo que falta; nunca pisa una entidad existente. Con dryRun responde qué haría sin escribir.',
  })
  @ApiOkResponse({
    description: 'Resumen de lo sembrado.',
    type: FinancialInstitutionSeedSummaryDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  seed(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() body: { dryRun?: boolean },
  ) {
    return this.institutions.syncSeed(tenantId, body?.dryRun === true, principal.id);
  }
}
