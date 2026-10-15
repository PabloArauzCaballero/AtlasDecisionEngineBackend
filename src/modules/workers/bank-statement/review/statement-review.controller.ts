import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiArrayResponse, ApiPagedResponse } from '../../../../common/http/pagination.dto';
import { CurrentPrincipal, Roles, TenantId } from '../../../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../../../common/security/security.types';
import {
  ReprocessStatementReviewDto,
  ResolveStatementReviewDto,
  StatementReprocessedDto,
  StatementReviewCategoryDto,
  StatementReviewItemDto,
  StatementReviewQueryDto,
} from './statement-review.dto';
import { StatementReprocessService } from './statement-reprocess.service';
import { StatementReviewDocuments } from './statement-review-documents.service';
import { StatementReviewClaimService } from './statement-review-claim.service';
import { StatementReviewQueueService } from './statement-review-queue.service';
import { StatementReviewResolutionService } from './statement-review-resolution.service';

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
  constructor(
    private readonly queue: StatementReviewQueueService,
    private readonly claims: StatementReviewClaimService,
    private readonly resolutions: StatementReviewResolutionService,
    private readonly reprocesses: StatementReprocessService,
    private readonly documents: StatementReviewDocuments,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Cola de documentos pendientes de revisión humana' })
  @ApiPagedResponse(
    'Página de casos, por prioridad y antigüedad. Nunca incluye documentos rechazados.',
    StatementReviewItemDto,
  )
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async list(@TenantId() tenantId: bigint, @Query() query: StatementReviewQueryDto) {
    return this.queue.list(tenantId, query);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Contadores por categoría de la cola de revisión' })
  @ApiArrayResponse(
    'Una fila por categoría con trabajo, más la fila «Todos». Los contadores son del total, no de la página.',
    StatementReviewCategoryDto,
  )
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async categories(@TenantId() tenantId: bigint): Promise<StatementReviewCategoryDto[]> {
    return this.queue.categories(tenantId);
  }

  @Get(':requestId')
  @ApiOperation({ summary: 'Un caso, con su clasificación, lo extraído y lo que falló' })
  @ApiOkResponse({ type: StatementReviewItemDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async get(@TenantId() tenantId: bigint, @Param('requestId') requestId: string) {
    return this.queue.get(tenantId, requestId);
  }

  /**
   * El PDF que subió el cliente, para verlo al revisar. Antes no había forma de abrirlo: el caso decía
   * «el PDF original sigue guardado» y nada más.
   *
   * `inline` (para el visor del portal) y sin caché: es el documento más sensible del expediente.
   * `nosniff` porque el tipo lo fija el servidor, no el contenido.
   */
  @Get(':requestId/document')
  @ApiOperation({ summary: 'El PDF original del caso, para verlo al revisar' })
  @ApiOkResponse({
    description: 'El PDF tal como lo subió el cliente.',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS', 'COMPLIANCE', 'AUDITOR')
  async document(
    @TenantId() tenantId: bigint,
    @Param('requestId') requestId: string,
    @Res() response: Response,
  ): Promise<void> {
    const pdf = await this.documents.read(tenantId, requestId);
    const name = (pdf.fileName || 'extracto.pdf').replace(/["\\\r\n]/g, '');
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `inline; filename="${name}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(pdf.content);
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
    return this.claims.claim(tenantId, requestId, principal);
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
    return this.resolutions.resolve(tenantId, requestId, dto, principal);
  }

  @Post(':requestId/reprocess')
  @ApiOperation({
    summary:
      'Devuelve el documento a la cola del worker, opcionalmente con la entidad asignada a mano',
  })
  @ApiOkResponse({ description: 'La ejecución vuelve a `QUEUED`.', type: StatementReprocessedDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'OPERATIONS')
  async reprocess(
    @TenantId() tenantId: bigint,
    @Param('requestId') requestId: string,
    @Body() dto: ReprocessStatementReviewDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ) {
    return this.reprocesses.reprocess(tenantId, requestId, principal, dto?.institutionCode);
  }
}
