import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import {
  CreateTestSuiteDto,
  ImportTestCasesDto,
  RunTestSuiteDto,
  TestCaseDto,
  TestSuiteListQueryDto,
} from './testing.dto';
import { TestExecutionService } from './test-execution.service';
import { TestSuiteService } from './test-suite.service';

@ApiTags('Decision Testing')
@Controller('v1')
export class TestingController {
  constructor(
    private readonly suites: TestSuiteService,
    private readonly execution: TestExecutionService,
  ) {}

  @Post('artifact-versions/:versionId/test-suites')
  @Roles('QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST')
  createSuite(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('versionId') versionId: string,
    @Body() dto: CreateTestSuiteDto,
  ) {
    return this.suites.createSuite(tenantId, parseBigIntId(versionId, 'versionId'), dto, principal);
  }

  @Get('artifact-versions/:versionId/test-suites')
  @Roles('QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE', 'AUDITOR')
  listSuites(
    @TenantId() tenantId: bigint,
    @Param('versionId') versionId: string,
    @Query() query: TestSuiteListQueryDto,
  ) {
    return this.suites.listSuites(tenantId, parseBigIntId(versionId, 'versionId'), query);
  }

  @Get('test-suites/:suiteId/cases')
  @Roles('QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE', 'AUDITOR')
  listCases(@TenantId() tenantId: bigint, @Param('suiteId') suiteId: string) {
    return this.suites.listCases(tenantId, parseBigIntId(suiteId, 'suiteId'));
  }

  @Post('test-suites/:suiteId/cases')
  @Roles('QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST')
  createCase(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('suiteId') suiteId: string,
    @Body() dto: TestCaseDto,
  ) {
    return this.suites
      .addCases(tenantId, parseBigIntId(suiteId, 'suiteId'), [dto], principal)
      .then(([testCase]) => testCase);
  }

  @Post('test-suites/:suiteId/cases/import')
  @Roles('QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST')
  importCases(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('suiteId') suiteId: string,
    @Body() dto: ImportTestCasesDto,
  ) {
    return this.suites.addCases(tenantId, parseBigIntId(suiteId, 'suiteId'), dto.cases, principal);
  }

  @Post('test-suites/:suiteId/runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles('QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST')
  run(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('suiteId') suiteId: string,
    @Body() dto: RunTestSuiteDto,
  ) {
    return this.execution.enqueueSuite(tenantId, parseBigIntId(suiteId, 'suiteId'), dto, principal);
  }

  @Get('test-runs/:runId')
  @Roles('QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE', 'AUDITOR')
  getRun(@TenantId() tenantId: bigint, @Param('runId') runId: string) {
    return this.execution.getRun(tenantId, parseBigIntId(runId, 'runId'));
  }
}
