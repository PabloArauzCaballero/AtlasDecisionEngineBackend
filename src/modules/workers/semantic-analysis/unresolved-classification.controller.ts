import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CurrentPrincipal, Roles, TenantId } from '../../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../../common/security/security.types';
import { UpsertSemanticCategoryDto } from './semantic-category.dto';
import {
  UnresolvedClassificationService,
  type UnresolvedStatus,
} from './unresolved-classification.service';
import {
  ReevaluationStateDto,
  ResolveUnresolvedResultDto,
  UnresolvedClassificationDto,
  UnresolvedCountsDto,
} from './unresolved-classification.response.dto';
import { UnresolvedResolutionService } from './unresolved-resolution.service';
import { UnresolvedReevaluationService } from './unresolved-reevaluation.service';

const TIPOS = [
  'USE_SUGGESTED',
  'ASSIGN_EXISTING',
  'CREATE_CATEGORY',
  'CREATE_ALIAS',
  'DISCARD',
  'NOT_CATEGORIZED',
] as const;

export class ResolveUnresolvedDto {
  @IsIn([...TIPOS])
  @ApiPropertyOptional({ enum: TIPOS })
  resolutionType!: (typeof TIPOS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  @ApiPropertyOptional({ example: 'GASTOS.PROFESIONALES' })
  categoryCode?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpsertSemanticCategoryDto)
  @ApiPropertyOptional({ type: UpsertSemanticCategoryDto })
  newCategory?: UpsertSemanticCategoryDto;

  @IsOptional()
  @IsObject()
  @ApiPropertyOptional()
  metadata?: Record<string, unknown>;
}

/**
 * Bandeja de valores pendientes de clasificar.
 *
 * **Leer y resolver piden roles distintos.** Ver qué quedó sin clasificar es
 * diagnóstico y lo necesita quien opera; resolverlo cambia el catálogo y con él
 * cómo decide el motor a partir de ese momento, así que exige el rol que
 * gobierna los artefactos de decisión.
 */
@ApiTags('Workers · Pendientes de clasificación')
@Controller('v1/workers/semantic-analysis/unresolved')
export class UnresolvedClassificationController {
  constructor(
    private readonly unresolved: UnresolvedClassificationService,
    private readonly resolution: UnresolvedResolutionService,
    private readonly reevaluation: UnresolvedReevaluationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Pendientes, los más frecuentes primero' })
  @ApiOkResponse({ description: 'Valores sin clasificar.', type: [UnresolvedClassificationDto] })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS')
  list(
    @TenantId() tenantId: bigint,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.unresolved.list(tenantId, {
      status: (status as UnresolvedStatus | undefined) ?? 'PENDING',
      search,
    });
  }

  @Get('count')
  @ApiOperation({ summary: 'Cuántos pendientes hay' })
  @ApiOkResponse({ description: 'Contador de pendientes.', type: UnresolvedCountsDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS')
  count(@TenantId() tenantId: bigint) {
    return this.unresolved.counts(tenantId);
  }

  /**
   * Reevalúa la bandeja contra el catálogo actual.
   *
   * Va antes que `:id/resolve` en el archivo porque también lo va en la tabla de
   * rutas: `reevaluate` encajaría en `:id` y Nest resuelve por orden de
   * declaración, así que declarada después nunca se alcanzaría.
   *
   * Pide el mismo rol que resolver: no decide nada que una persona no pudiera
   * decidir, pero cierra pendientes y eso cambia lo que la bandeja afirma.
   */
  @Post('reevaluate')
  @ApiOperation({ summary: 'Arranca la reevaluación de los pendientes con el catálogo de hoy' })
  @ApiOkResponse({
    description: 'Estado de la pasada, que corre en segundo plano.',
    type: ReevaluationStateDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  reevaluate(@TenantId() tenantId: bigint) {
    return this.reevaluation.start(tenantId);
  }

  /** Cómo va la pasada. La pantalla lo consulta para saber cuándo parar de refrescar. */
  @Get('reevaluate/status')
  @ApiOperation({ summary: 'Estado de la reevaluación en curso' })
  @ApiOkResponse({
    description: 'Si corre, cuántos quedan y el resultado de la última.',
    type: ReevaluationStateDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS')
  reevaluationStatus(@TenantId() tenantId: bigint) {
    return this.reevaluation.state(tenantId);
  }

  @Post(':id/resolve')
  @ApiOperation({ summary: 'Resuelve un pendiente y enseña el alias al catálogo' })
  @ApiOkResponse({ description: 'Pendiente resuelto.', type: ResolveUnresolvedResultDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  resolve(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() dto: ResolveUnresolvedDto,
  ) {
    return this.resolution.resolve({
      tenantId,
      id,
      resolutionType: dto.resolutionType,
      categoryCode: dto.categoryCode,
      newCategory: dto.newCategory,
      resolvedBy: principal.id,
    });
  }
}
