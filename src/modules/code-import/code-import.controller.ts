import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { AnalyzeCodeImportDto, CodeImportListQueryDto, SaveCodeImportDto } from './code-import.dto';
import { CodeImportService } from './code-import.service';

@ApiTags('Code to Flow Import')
@Controller('v1/code-imports')
export class CodeImportController {
  constructor(private readonly codeImports: CodeImportService) {}

  @Post()
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  analyze(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: AnalyzeCodeImportDto,
  ) {
    return this.codeImports.analyze(tenantId, dto, principal);
  }

  @Get()
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'AUDITOR')
  list(@TenantId() tenantId: bigint, @Query() query: CodeImportListQueryDto) {
    return this.codeImports.list(tenantId, query);
  }

  @Get(':id')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'AUDITOR')
  get(@TenantId() tenantId: bigint, @Param('id') id: string) {
    return this.codeImports.get(tenantId, parseBigIntId(id, 'id'));
  }

  @Post(':id/save-draft')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  saveDraft(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() dto: SaveCodeImportDto,
  ) {
    return this.codeImports.saveDraft(tenantId, parseBigIntId(id, 'id'), dto, principal);
  }

  @Post(':id/confirm')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  confirm(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
    @Body() dto: SaveCodeImportDto,
  ) {
    return this.codeImports.confirm(tenantId, parseBigIntId(id, 'id'), dto, principal);
  }

  @Post(':id/cancel')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  cancel(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ) {
    return this.codeImports.cancel(tenantId, parseBigIntId(id, 'id'), principal);
  }
}
