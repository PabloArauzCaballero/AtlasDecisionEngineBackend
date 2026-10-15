import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import { ApiPagedResponse } from '../../common/http/pagination.dto';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { ApprovalDecisionService } from './approval-decision.service';
import { ApprovalQueryService } from './approval-query.service';
import { ApprovalSubmissionService } from './approval-submission.service';
import {
  ApprovalRequestListQueryDto,
  RecordApprovalDecisionDto,
  SubmitReviewDto,
} from './governance.dto';
import { ApprovalRequestListItemDto } from './governance.response.dto';

@ApiTags('Decision Governance')
@Controller('v1')
export class GovernanceController {
  constructor(
    private readonly queries: ApprovalQueryService,
    private readonly submissions: ApprovalSubmissionService,
    private readonly decisions: ApprovalDecisionService,
  ) {}

  @Get('approval-requests')
  @ApiOperation({ summary: 'List the tenant approval queue' })
  @ApiPagedResponse('Página de la cola de aprobación del tenant.', ApprovalRequestListItemDto)
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'RISK_APPROVER', 'COMPLIANCE', 'AUDITOR')
  list(@TenantId() tenantId: bigint, @Query() query: ApprovalRequestListQueryDto) {
    return this.queries.listRequests(tenantId, query);
  }

  @Post('artifact-versions/:versionId/submit-for-review')
  @ApiOperation({ summary: 'Submit a validated version for ordered review' })
  @Roles('QA_ANALYST', 'FRAUD_ANALYST')
  submit(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('versionId') versionId: string,
    @Body() dto: SubmitReviewDto,
  ) {
    return this.submissions.submitForReview(
      tenantId,
      parseBigIntId(versionId, 'versionId'),
      dto,
      principal,
    );
  }

  @Post('approval-steps/:stepId/decisions')
  @ApiOperation({ summary: 'Record a role-authorized approval decision' })
  @Roles('QA_ANALYST', 'RISK_APPROVER', 'COMPLIANCE')
  decide(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('stepId') stepId: string,
    @Body() dto: RecordApprovalDecisionDto,
  ) {
    return this.decisions.recordDecision(tenantId, parseBigIntId(stepId, 'stepId'), dto, principal);
  }

  @Get('approval-requests/:requestId')
  @ApiOperation({ summary: 'Get one approval request and all evidence' })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'RISK_APPROVER', 'COMPLIANCE', 'AUDITOR')
  get(@TenantId() tenantId: bigint, @Param('requestId') requestId: string) {
    return this.queries.getRequest(tenantId, parseBigIntId(requestId, 'requestId'));
  }
}
