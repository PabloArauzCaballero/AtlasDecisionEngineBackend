import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiArrayResponse, ApiPagedResponse } from '../../../../common/http/pagination.dto';
import { CurrentPrincipal, Roles, TenantId } from '../../../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../../../common/security/security.types';
import {
  ResolveStatementReviewDto,
  StatementReprocessedDto,
  StatementReviewCategoryDto,
  StatementReviewItemDto,
  StatementReviewQueryDto,
} from './statement-review.dto';
import { StatementReviewService } from './statement-review.service';

/**
 * Cola de revisión humana de extractos.
 *
 * Ruta propia bajo el worker (`/v1/workers/bank-statement/reviews`) y no dentro
 * de `/runs`: son dos preguntas distintas sobre la misma tabla —«¿qué ha pasado
 * con lo que subí?» y «¿qué tengo que decidir?»— y colgarla de `/runs` obligaba a
 * filtrar por estado desde el cliente, que es como los pendientes acabaron
 * escondidos entre el historial.
 *
 * **Leer la cola y resolverla no exigen el mismo rol.** Cumplimiento y auditoría
 * necesitan verla; decidir sobre un documento bancario de una persona es un acto
 * con consecuencia y se reserva a quien opera el riesgo.
 */
@ApiTags('Workers · Extractos bancarios')
@Controller('v1/workers/bank-statement/reviews')
export class StatementReviewController {
  constructor(private readonly reviews: StatementReviewService) {}

  @Get()
  @ApiOperation({ summary: 'Cola de documentos pendientes de revisión humana' })
  @ApiPagedResponse(
    'Página de casos, por prioridad y antigüedad. Nunca incluye documentos rechazados.',
    StatementReviewItemDto,
  )
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async list(@TenantId() tenantId: bigint, @Query() query: StatementReviewQueryDto) {
    return this.reviews.list(tenantId, query);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Contadores por categoría de la cola de revisión' })
  @ApiArrayResponse(
    'Una fila por categoría con trabajo, más la fila «Todos». Los contadores son del total, no de la página.',
    StatementReviewCategoryDto,
  )
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async categories(@TenantId() tenantId: bigint): Promise<StatementReviewCategoryDto[]> {
    return this.reviews.categories(tenantId);
  }

  @Get(':requestId')
  @ApiOperation({ summary: 'Un caso, con su clasificación, lo extraído y lo que falló' })
  @ApiOkResponse({ type: StatementReviewItemDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async get(@TenantId() tenantId: bigint, @Param('requestId') requestId: string) {
    return this.reviews.get(tenantId, requestId);
  }

  @Post(':requestId/claim')
  @ApiOperation({ summary: 'Reclama el caso para revisarlo' })
  @ApiOkResponse({ type: StatementReviewItemDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS')
  async claim(
    @TenantId() tenantId: bigint,
    @Param('requestId') requestId: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.reviews.claim(tenantId, requestId, principal);
  }

  @Post(':requestId/resolve')
  @ApiOperation({ summary: 'Cierra el caso: aprobar, corregir, rechazar o marcar no válido' })
  @ApiOkResponse({ type: StatementReviewItemDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS')
  async resolve(
    @TenantId() tenantId: bigint,
    @Param('requestId') requestId: string,
    @Body() dto: ResolveStatementReviewDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.reviews.resolve(tenantId, requestId, dto, principal);
  }

  @Post(':requestId/reprocess')
  @ApiOperation({ summary: 'Devuelve el documento a la cola del worker' })
  @ApiOkResponse({ description: 'La ejecución vuelve a `QUEUED`.', type: StatementReprocessedDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS')
  async reprocess(
    @TenantId() tenantId: bigint,
    @Param('requestId') requestId: string,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.reviews.reprocess(tenantId, requestId, principal);
  }
}
