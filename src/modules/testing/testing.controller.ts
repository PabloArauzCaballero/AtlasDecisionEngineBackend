import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import { ApiArrayResponse, ApiPagedResponse } from '../../common/http/pagination.dto';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import {
  CreateTestSuiteDto,
  ImportTestCasesDto,
  RunTestSuiteDto,
  TestCaseDto,
  TestSuiteListQueryDto,
} from './testing.dto';
import {
  TestCaseRecordDto,
  TestRunDetailDto,
  TestRunQueuedDto,
  TestSuiteCreatedDto,
  TestSuiteWithEvidenceDto,
} from './testing.response.dto';
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
  @ApiOperation({ summary: 'Create a version-scoped suite with initial cases' })
  @ApiCreatedResponse({
    description: 'Suite creada con sus casos iniciales.',
    type: TestSuiteCreatedDto,
  })
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
  @ApiOperation({ summary: 'List suites and recent run evidence for a version' })
  @ApiPagedResponse(
    'Página de suites de la versión, con la evidencia de sus corridas recientes.',
    TestSuiteWithEvidenceDto,
  )
  @Roles('QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE', 'AUDITOR')
  listSuites(
    @TenantId() tenantId: bigint,
    @Param('versionId') versionId: string,
    @Query() query: TestSuiteListQueryDto,
  ) {
    return this.suites.listSuites(tenantId, parseBigIntId(versionId, 'versionId'), query);
  }

  @Get('test-suites/:suiteId/cases')
  @ApiOperation({ summary: 'List deterministic cases in a suite' })
  @ApiArrayResponse(
    'Casos de la suite, ordenados por código. Array desnudo: una suite está acotada por diseño y no se pagina.',
    TestCaseRecordDto,
  )
  @Roles('QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE', 'AUDITOR')
  listCases(@TenantId() tenantId: bigint, @Param('suiteId') suiteId: string) {
    return this.suites.listCases(tenantId, parseBigIntId(suiteId, 'suiteId'));
  }

  @Post('test-suites/:suiteId/cases')
  @ApiOperation({ summary: 'Add one case to a suite' })
  @ApiCreatedResponse({ description: 'Caso creado.', type: TestCaseRecordDto })
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
  @ApiOperation({ summary: 'Add a bounded batch of cases to a suite' })
  @ApiCreatedResponse({ description: 'Casos creados.', type: [TestCaseRecordDto] })
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
  @ApiOperation({ summary: 'Queue an asynchronous test run' })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({
    description: 'Corrida encolada; aún sin casos ejecutados.',
    type: TestRunQueuedDto,
  })
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
  @ApiOperation({ summary: 'Get run status, assertions and graph coverage' })
  @ApiOkResponse({
    description: 'Corrida con evidencia completa por caso.',
    type: TestRunDetailDto,
  })
  @Roles('QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE', 'AUDITOR')
  getRun(@TenantId() tenantId: bigint, @Param('runId') runId: string) {
    return this.execution.getRun(tenantId, parseBigIntId(runId, 'runId'));
  }
}
