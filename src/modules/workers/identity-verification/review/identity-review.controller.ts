import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiArrayResponse, ApiPagedResponse } from '../../../../common/http/pagination.dto';
import { CurrentPrincipal, Roles, TenantId } from '../../../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../../../common/security/security.types';
import {
  IdentityReviewCategoryDto,
  IdentityReviewItemDto,
  IdentityReviewQueryDto,
  IdentityReviewResolvedDto,
  ResolveIdentityReviewDto,
} from './identity-review.dto';
import { IdentityReviewService } from './identity-review.service';

/**
 * Cola de arbitraje humano de documentos de identidad.
 *
 * Ruta propia bajo el worker (`/v1/workers/identity-verification/reviews`) y no
 * dentro de `/runs`: son dos preguntas distintas sobre la misma tabla —«¿qué ha
 * pasado con lo que subí?» y «¿qué tengo que decidir?»— y colgarla de `/runs`
 * obligaba a filtrar por estado desde el cliente, que es como los pendientes
 * acaban escondidos entre el historial.
 *
 * **Leer la cola y resolverla no exigen el mismo rol.** Cumplimiento y auditoría
 * necesitan verla; afirmar que el carnet de una persona es o no es su carnet es
 * un acto con consecuencia y se reserva a quien opera el riesgo y el fraude.
 */
@ApiTags('Workers · Verificación de identidad')
@Controller('v1/workers/identity-verification/reviews')
export class IdentityReviewController {
  constructor(private readonly reviews: IdentityReviewService) {}

  @Get()
  @ApiOperation({ summary: 'Cola de documentos a la espera de arbitraje' })
  @ApiPagedResponse(
    'Página de casos, por prioridad y antigüedad. Nunca incluye documentos rechazados.',
    IdentityReviewItemDto,
  )
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async list(@TenantId() tenantId: bigint, @Query() query: IdentityReviewQueryDto) {
    return this.reviews.list(tenantId, query);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Contadores por categoría de la cola de arbitraje' })
  @ApiArrayResponse(
    'Una fila por categoría con trabajo, más la fila «Todos». Los contadores son del total, no de la página.',
    IdentityReviewCategoryDto,
  )
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async categories(@TenantId() tenantId: bigint): Promise<IdentityReviewCategoryDto[]> {
    return this.reviews.categories(tenantId);
  }

  @Get(':requestId')
  @ApiOperation({ summary: 'Un caso, con la evidencia que lo trajo a la cola' })
  @ApiOkResponse({ type: IdentityReviewItemDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async get(@TenantId() tenantId: bigint, @Param('requestId') requestId: string) {
    return this.reviews.get(tenantId, requestId);
  }

  @Post(':requestId/claim')
  @ApiOperation({ summary: 'Reclama el caso para arbitrarlo' })
  @ApiOkResponse({ type: IdentityReviewItemDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS')
  async claim(
    @TenantId() tenantId: bigint,
    @Param('requestId') requestId: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.reviews.claim(tenantId, requestId, principal);
  }

  @Post(':requestId/resolve')
  @ApiOperation({
    summary: 'Cierra el caso: confirmar el documento y reanudar, o rechazarlo',
  })
  @ApiOkResponse({ type: IdentityReviewResolvedDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS')
  async resolve(
    @TenantId() tenantId: bigint,
    @Param('requestId') requestId: string,
    @Body() dto: ResolveIdentityReviewDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<IdentityReviewResolvedDto> {
    return this.reviews.resolve(tenantId, requestId, dto, principal);
  }
}
