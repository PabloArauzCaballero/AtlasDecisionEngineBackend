/** Read/export boundary for the security team's aggregated review evidence. */
import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { PlatformRole } from '../../common/security/platform-roles';
import { Roles, TenantId } from '../../common/security/security.decorators';
import { SecurityReviewDto } from './security-review.response.dto';
import { SecurityReviewService } from './security-review.service';

const SECURITY_TEAM_ROLES: PlatformRole[] = [
  PlatformRole.COMPLIANCE,
  PlatformRole.FRAUD_ANALYST,
  PlatformRole.RISK_APPROVER,
  PlatformRole.AUDITOR,
];

@ApiTags('Security Review')
@Controller('v1/security-review')
export class SecurityReviewController {
  constructor(private readonly securityReview: SecurityReviewService) {}

  @Get('versions/:versionId')
  @ApiOperation({ summary: 'Aggregate security and governance evidence for a version' })
  @ApiOkResponse({
    description: 'Evidencia agregada de seguridad y gobierno.',
    type: SecurityReviewDto,
  })
  @Roles(...SECURITY_TEAM_ROLES)
  get(@TenantId() tenantId: bigint, @Param('versionId') versionId: string) {
    return this.securityReview.getVersionReview(tenantId, parseBigIntId(versionId, 'versionId'));
  }

  @Get('versions/:versionId/export')
  @ApiOperation({ summary: 'Export a reproducible security-review snapshot' })
  @ApiOkResponse({
    description: 'Misma forma que el detalle, como archivo adjunto.',
    type: SecurityReviewDto,
  })
  @Roles(...SECURITY_TEAM_ROLES)
  @Header('Content-Type', 'application/json')
  @Header('Content-Disposition', 'attachment; filename="security-review.json"')
  export(@TenantId() tenantId: bigint, @Param('versionId') versionId: string) {
    return this.securityReview.exportReport(tenantId, parseBigIntId(versionId, 'versionId'));
  }
}
