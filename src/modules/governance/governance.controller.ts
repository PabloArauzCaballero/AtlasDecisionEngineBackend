import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { parseBigIntId } from "../../common/http/id";
import {
  CurrentPrincipal,
  Roles,
  TenantId,
} from "../../common/security/security.decorators";
import type { AuthenticatedPrincipal } from "../../common/security/security.types";
import { GovernanceService } from "./governance.service";
import {
  ApprovalRequestListQueryDto,
  RecordApprovalDecisionDto,
  SubmitReviewDto,
} from "./governance.dto";

@ApiTags("Decision Governance")
@Controller("v1")
export class GovernanceController {
  constructor(private readonly governance: GovernanceService) {}

  @Get("approval-requests")
  @Roles(
    "RISK_ANALYST",
    "FRAUD_ANALYST",
    "QA_ANALYST",
    "RISK_APPROVER",
    "COMPLIANCE",
    "AUDITOR",
  )
  list(
    @TenantId() tenantId: bigint,
    @Query() query: ApprovalRequestListQueryDto,
  ) {
    return this.governance.listRequests(tenantId, query);
  }

  @Post("artifact-versions/:versionId/submit-for-review")
  @Roles("RISK_ANALYST", "FRAUD_ANALYST")
  submit(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param("versionId") versionId: string,
    @Body() dto: SubmitReviewDto,
  ) {
    return this.governance.submitForReview(
      tenantId,
      parseBigIntId(versionId, "versionId"),
      dto,
      principal,
    );
  }

  @Post("approval-steps/:stepId/decisions")
  @Roles("QA_ANALYST", "RISK_APPROVER", "COMPLIANCE")
  decide(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param("stepId") stepId: string,
    @Body() dto: RecordApprovalDecisionDto,
  ) {
    return this.governance.recordDecision(
      tenantId,
      parseBigIntId(stepId, "stepId"),
      dto,
      principal,
    );
  }

  @Get("approval-requests/:requestId")
  @Roles(
    "RISK_ANALYST",
    "FRAUD_ANALYST",
    "QA_ANALYST",
    "RISK_APPROVER",
    "COMPLIANCE",
    "AUDITOR",
  )
  get(@TenantId() tenantId: bigint, @Param("requestId") requestId: string) {
    return this.governance.getRequest(
      tenantId,
      parseBigIntId(requestId, "requestId"),
    );
  }
}
