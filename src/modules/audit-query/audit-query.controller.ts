import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { Roles, TenantId } from '../../common/security/security.decorators';
import { AuditEventSearchQueryDto, ExecutionSearchQueryDto } from './audit-query.dto';
import { AuditQueryService } from './audit-query.service';

@ApiTags('Audit and Observability')
@Controller('v1/audit')
@Roles('AUDITOR', 'COMPLIANCE', 'RISK_ANALYST', 'OPERATIONS')
export class AuditQueryController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get('executions/:executionId')
  getExecution(@TenantId() tenantId: bigint, @Param('executionId') executionId: string) {
    return this.audit.getExecution(tenantId, parseBigIntId(executionId, 'executionId'));
  }

  @Get('executions')
  search(@TenantId() tenantId: bigint, @Query() query: ExecutionSearchQueryDto) {
    return this.audit.searchExecutions(tenantId, query);
  }

  @Get('events')
  events(@TenantId() tenantId: bigint, @Query() query: AuditEventSearchQueryDto) {
    return this.audit.listAuditEvents(tenantId, query);
  }

  @Get('chain/verify')
  verify(@TenantId() tenantId: bigint) {
    return this.audit.verifyAuditChain(tenantId);
  }

  @Get('metrics')
  metrics(@TenantId() tenantId: bigint, @Query('artifactCode') artifactCode?: string) {
    return this.audit.metrics(tenantId, artifactCode);
  }
}
