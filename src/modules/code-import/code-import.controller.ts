import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import { ApiPagedResponse } from '../../common/http/pagination.dto';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { AnalyzeCodeImportDto, CodeImportListQueryDto, SaveCodeImportDto } from './code-import.dto';
import {
  CodeImportAnalyzedDto,
  CodeImportConfirmedDto,
  CodeImportDraftSavedDto,
  CodeImportRecordDto,
} from './code-import.response.dto';
import { CodeImportService } from './code-import.service';

@ApiTags('Code to Flow Import')
@Controller('v1/code-imports')
export class CodeImportController {
  constructor(private readonly codeImports: CodeImportService) {}

  @Post()
  @ApiOperation({ summary: 'Analyze source code and create a graph preview' })
  @ApiCreatedResponse({
    description: 'IR, incidencias y vista previa del grafo generado.',
    type: CodeImportAnalyzedDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  analyze(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: AnalyzeCodeImportDto,
  ) {
    return this.codeImports.analyze(tenantId, dto, principal);
  }

  @Get()
  @ApiOperation({ summary: 'List code-import analyses' })
  @ApiPagedResponse('Página de análisis de importación de código.', CodeImportRecordDto)
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'AUDITOR')
  list(@TenantId() tenantId: bigint, @Query() query: CodeImportListQueryDto) {
    return this.codeImports.list(tenantId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get source, contract, issues and generated graph' })
  @ApiOkResponse({ description: 'Registro completo del análisis.', type: CodeImportRecordDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'AUDITOR')
  get(@TenantId() tenantId: bigint, @Param('id') id: string) {
    return this.codeImports.get(tenantId, parseBigIntId(id, 'id'));
  }

  @Post(':id/save-draft')
  @ApiOperation({ summary: 'Write the generated graph into an editable artifact version' })
  @ApiCreatedResponse({
    description: 'Grafo escrito en la versión editable.',
    type: CodeImportDraftSavedDto,
  })
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
  @ApiOperation({ summary: 'Write, validate and compile an analyzed import' })
  @ApiCreatedResponse({
    description: 'Grafo escrito, validado y compilado.',
    type: CodeImportConfirmedDto,
  })
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
  @ApiOperation({ summary: 'Cancel a code import without changing an artifact' })
  @ApiCreatedResponse({ description: 'Análisis cancelado.', type: CodeImportRecordDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST')
  cancel(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('id') id: string,
  ) {
    return this.codeImports.cancel(tenantId, parseBigIntId(id, 'id'), principal);
  }
}
