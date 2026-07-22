import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import {
  AssignManualReviewDto,
  ManualReviewListQueryDto,
  ResolveManualReviewDto,
} from './manual-review.dto';
import { ManualReviewService } from './manual-review.service';

@ApiTags('Manual Review')
@Controller('v1/manual-reviews')
@Roles('OPERATIONS', 'RISK_ANALYST', 'FRAUD_ANALYST')
export class ManualReviewController {
  constructor(private readonly reviews: ManualReviewService) {}

  @Get()
  list(@TenantId() tenantId: bigint, @Query() query: ManualReviewListQueryDto) {
    return this.reviews.list(tenantId, query);
  }

  @Get(':caseId')
  get(@TenantId() tenantId: bigint, @Param('caseId') caseId: string) {
    return this.reviews.get(tenantId, parseBigIntId(caseId, 'caseId'));
  }

  @Post(':caseId/assign')
  assign(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('caseId') caseId: string,
    @Body() dto: AssignManualReviewDto,
  ) {
    return this.reviews.assign(tenantId, parseBigIntId(caseId, 'caseId'), dto, principal);
  }

  @Post(':caseId/resolve')
  resolve(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('caseId') caseId: string,
    @Body() dto: ResolveManualReviewDto,
  ) {
    return this.reviews.resolve(tenantId, parseBigIntId(caseId, 'caseId'), dto, principal);
  }
}
