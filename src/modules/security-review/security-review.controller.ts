import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { Roles, TenantId } from '../../common/security/security.decorators';
import { SecurityReviewService } from './security-review.service';

const SECURITY_TEAM_ROLES = ['COMPLIANCE', 'FRAUD_ANALYST', 'RISK_APPROVER', 'AUDITOR'];

@ApiTags('Security Review')
@Controller('v1/security-review')
export class SecurityReviewController {
  constructor(private readonly securityReview: SecurityReviewService) {}

  @Get('versions/:versionId')
  @Roles(...SECURITY_TEAM_ROLES)
  get(@TenantId() tenantId: bigint, @Param('versionId') versionId: string) {
    return this.securityReview.getVersionReview(tenantId, parseBigIntId(versionId, 'versionId'));
  }

  @Get('versions/:versionId/export')
  @Roles(...SECURITY_TEAM_ROLES)
  @Header('Content-Type', 'application/json')
  @Header('Content-Disposition', 'attachment; filename="security-review.json"')
  export(@TenantId() tenantId: bigint, @Param('versionId') versionId: string) {
    return this.securityReview.exportReport(tenantId, parseBigIntId(versionId, 'versionId'));
  }
}
