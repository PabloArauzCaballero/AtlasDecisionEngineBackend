import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { parseBigIntId } from "../../common/http/id";
import {
  CurrentPrincipal,
  Roles,
  TenantId,
} from "../../common/security/security.decorators";
import type { AuthenticatedPrincipal } from "../../common/security/security.types";
import {
  CreateBusinessObjectiveDto,
  LinkPolicyArtifactDto,
  LinkPolicyTestSuiteDto,
  ObjectiveListQueryDto,
} from "./traceability.dto";
import { TraceabilityService } from "./traceability.service";

@ApiTags("Requirements Traceability")
@Controller("v1/traceability")
export class TraceabilityController {
  constructor(private readonly traceability: TraceabilityService) {}

  @Post("objectives")
  @Roles("RISK_ANALYST", "COMPLIANCE")
  create(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: CreateBusinessObjectiveDto,
  ) {
    return this.traceability.createObjective(tenantId, dto, principal);
  }

  @Get("objectives")
  @Roles("RISK_ANALYST", "QA_ANALYST", "COMPLIANCE", "AUDITOR")
  list(@TenantId() tenantId: bigint, @Query() query: ObjectiveListQueryDto) {
    return this.traceability.list(tenantId, query);
  }

  @Get("objectives/:objectiveId")
  @Roles("RISK_ANALYST", "QA_ANALYST", "COMPLIANCE", "AUDITOR")
  getObjective(
    @TenantId() tenantId: bigint,
    @Param("objectiveId") objectiveId: string,
  ) {
    return this.traceability.getObjective(
      tenantId,
      parseBigIntId(objectiveId, "objectiveId"),
    );
  }

  @Get("coverage-matrix")
  @Roles("RISK_ANALYST", "QA_ANALYST", "COMPLIANCE", "AUDITOR")
  coverageMatrix(@TenantId() tenantId: bigint) {
    return this.traceability.coverageMatrix(tenantId);
  }

  @Post("policies/:policyId/artifacts")
  @Roles("RISK_ANALYST", "COMPLIANCE")
  linkArtifact(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param("policyId") policyId: string,
    @Body() dto: LinkPolicyArtifactDto,
  ) {
    return this.traceability.linkArtifact(
      tenantId,
      parseBigIntId(policyId, "policyId"),
      dto,
      principal,
    );
  }

  @Post("policies/:policyId/test-suites")
  @Roles("RISK_ANALYST", "QA_ANALYST", "COMPLIANCE")
  linkTest(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param("policyId") policyId: string,
    @Body() dto: LinkPolicyTestSuiteDto,
  ) {
    return this.traceability.linkTestSuite(
      tenantId,
      parseBigIntId(policyId, "policyId"),
      dto,
      principal,
    );
  }
}
