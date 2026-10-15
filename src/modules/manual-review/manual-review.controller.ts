import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import { ApiPagedResponse } from '../../common/http/pagination.dto';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import {
  AssignManualReviewDto,
  ManualReviewListQueryDto,
  ResolveManualReviewDto,
} from './manual-review.dto';
import {
  ManualReviewDetailDto,
  ManualReviewListItemDto,
  ManualReviewWriteResultDto,
} from './manual-review.response.dto';
import { ManualReviewAssignmentService } from './manual-review-assignment.service';
import { ManualReviewQueryService } from './manual-review-query.service';
import { ManualReviewResolutionService } from './manual-review-resolution.service';

@ApiTags('Manual Review')
@Controller('v1/manual-reviews')
@Roles('OPERATIONS', 'RISK_ANALYST', 'FRAUD_ANALYST')
export class ManualReviewController {
  constructor(
    private readonly queries: ManualReviewQueryService,
    private readonly assignments: ManualReviewAssignmentService,
    private readonly resolutions: ManualReviewResolutionService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List manual-review cases visible to the tenant' })
  @ApiPagedResponse('Página de casos de revisión manual del tenant.', ManualReviewListItemDto)
  list(@TenantId() tenantId: bigint, @Query() query: ManualReviewListQueryDto) {
    return this.queries.list(tenantId, query);
  }

  @Get(':caseId')
  @ApiOperation({ summary: 'Get one manual-review case and decision context' })
  @ApiOkResponse({
    description: 'Caso con la traza completa de la ejecución que lo originó.',
    type: ManualReviewDetailDto,
  })
  async get(@TenantId() tenantId: bigint, @Param('caseId') caseId: string) {
    return this.queries.get(tenantId, await this.queries.resolveCaseId(tenantId, caseId));
  }

  @Post(':caseId/assign')
  @ApiOperation({
    summary: 'Take an open case, or assign it to another analyst',
    description:
      'Sin `assignedTo` el caso queda a nombre de quien llama. Reasignar un caso que ya pertenece ' +
      'a otro analista exige un rol de supervisión (`OPERATIONS`, o `PLATFORM_ADMIN` sobre ' +
      'identidad firmada); en otro caso responde 403 `MANUAL_REVIEW_ASSIGN_FORBIDDEN`.',
  })
  @ApiCreatedResponse({ description: 'Caso asignado.', type: ManualReviewWriteResultDto })
  assign(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('caseId') caseId: string,
    @Body() dto: AssignManualReviewDto,
  ) {
    return this.assignments.assign(tenantId, parseBigIntId(caseId, 'caseId'), dto, principal);
  }

  @Post(':caseId/resolve')
  @ApiOperation({
    summary: 'Resolve a case as its assigned analyst',
    description:
      'Sólo el analista asignado, o un rol de supervisión cuando el asignado no está disponible. ' +
      'La resolución guarda `assignedTo` y `supervisorOverride`, así que un cierre por supervisión ' +
      'se distingue de uno normal sin reconstruirlo.',
  })
  @ApiCreatedResponse({ description: 'Caso resuelto.', type: ManualReviewWriteResultDto })
  resolve(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('caseId') caseId: string,
    @Body() dto: ResolveManualReviewDto,
  ) {
    return this.resolutions.resolve(tenantId, parseBigIntId(caseId, 'caseId'), dto, principal);
  }
}
