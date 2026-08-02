import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditChainVerificationDto, ExecutionMetricsDto } from './audit-query.response.dto';
import { parseBigIntId } from '../../common/http/id';
import { Roles, TenantId } from '../../common/security/security.decorators';
import { ApiKeysetResponse, ApiPagedResponse } from '../../common/http/pagination.dto';
import {
  AuditEventKeysetQueryDto,
  AuditEventSearchQueryDto,
  ExecutionSearchQueryDto,
} from './audit-query.dto';
import { AuditQueryService } from './audit-query.service';

@ApiTags('Audit and Observability')
@Controller('v1/audit')
@Roles('AUDITOR', 'COMPLIANCE', 'RISK_ANALYST', 'OPERATIONS')
export class AuditQueryController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get('executions/:executionId')
  @ApiOperation({ summary: 'Get one decision execution with its evidence' })
  getExecution(@TenantId() tenantId: bigint, @Param('executionId') executionId: string) {
    return this.audit.getExecution(tenantId, parseBigIntId(executionId, 'executionId'));
  }

  @Get('executions')
  @ApiOperation({ summary: 'Search decision executions with bounded pagination' })
  @ApiPagedResponse('Página de ejecuciones que cumplen el filtro.')
  search(@TenantId() tenantId: bigint, @Query() query: ExecutionSearchQueryDto) {
    return this.audit.searchExecutions(tenantId, query);
  }

  @Get('events')
  @ApiOperation({ summary: 'List audit events using offset pagination' })
  @ApiPagedResponse('Página de eventos de auditoría por desplazamiento.')
  events(@TenantId() tenantId: bigint, @Query() query: AuditEventSearchQueryDto) {
    return this.audit.listAuditEvents(tenantId, query);
  }

  // Additive sibling of GET events: same filters and roles, cursor-paginated. Kept as its own
  // route rather than a mode flag on `events` so one endpoint never returns two response
  // shapes, and so the existing offset contract is untouched for current consumers.
  @Get('events/cursor')
  @ApiOperation({ summary: 'List audit events using a stable keyset cursor' })
  @ApiKeysetResponse(
    'Página por cursor. Sin `total`: no contar es lo que la hace barata sobre un feed que crece sin cota.',
  )
  eventsByCursor(@TenantId() tenantId: bigint, @Query() query: AuditEventKeysetQueryDto) {
    return this.audit.listAuditEventsByCursor(tenantId, query);
  }

  @Get('chain/verify')
  @ApiOperation({ summary: 'Verify the tenant audit HMAC chain in batches' })
  @ApiOkResponse({
    description:
      'Resultado de recorrer la cadena del tenant. `valid: false` no siempre es manipulación: un `HASH_KEY_UNAVAILABLE` señala un secreto retirado que ya no se conserva.',
    type: AuditChainVerificationDto,
  })
  verify(@TenantId() tenantId: bigint) {
    return this.audit.verifyAuditChain(tenantId);
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Aggregate decision outcomes and latency evidence' })
  @ApiOkResponse({ description: 'Agregados de ejecución del tenant.', type: ExecutionMetricsDto })
  metrics(@TenantId() tenantId: bigint, @Query('artifactCode') artifactCode?: string) {
    return this.audit.metrics(tenantId, artifactCode);
  }
}
