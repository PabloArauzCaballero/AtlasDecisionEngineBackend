import { ApiProperty } from '@nestjs/swagger';

export class TestCaseRecordDto {
  @ApiProperty({ example: '8001' }) id!: string;
  @ApiProperty({ example: '7001' }) testSuiteId!: string;
  @ApiProperty({ example: 'HAPPY_PATH_APPROVE' }) caseCode!: string;
  @ApiProperty({ example: 'Approves a well-qualified applicant' }) testName!: string;
  @ApiProperty() inputJson!: Record<string, unknown>;
  @ApiProperty() expectedResultJson!: Record<string, unknown>;
  @ApiProperty({ nullable: true }) tagsJson!: unknown;
  @ApiProperty({ example: true }) isActive!: boolean;
}

class TestCoverageDto {
  @ApiProperty({ example: '9001' }) id!: string;
  @ApiProperty({ example: '8501' }) testRunId!: string;
  @ApiProperty({ example: 'NODE', enum: ['NODE', 'EDGE', 'TERMINAL_PATH'] }) coverageType!: string;
  @ApiProperty({ example: 11 }) coveredCount!: number;
  @ApiProperty({ example: 12 }) totalCount!: number;
  @ApiProperty({ example: '91.6667' }) coveragePercentage!: string;
  @ApiProperty({ nullable: true }) detailsJson!: Record<string, unknown> | null;
}

class TestRunSummaryDto {
  @ApiProperty({ example: '8501' }) id!: string;
  @ApiProperty({ example: '7001' }) testSuiteId!: string;
  @ApiProperty({ example: '77001' }) compiledArtifactId!: string;
  @ApiProperty({ example: 'MANUAL', enum: ['MANUAL', 'CI', 'GOVERNANCE_GATE'] })
  triggerType!: string;
  @ApiProperty({ example: 'analyst@atlas.local' }) triggeredBy!: string;
  @ApiProperty({ example: 'SUCCEEDED', enum: ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'] })
  status!: string;
  @ApiProperty({ example: '2026-07-20T10:00:00.000Z' }) queuedAt!: string;
  @ApiProperty({ nullable: true }) startedAt!: string | null;
  @ApiProperty({ nullable: true }) finishedAt!: string | null;
  @ApiProperty({ nullable: true }) leaseExpiresAt!: string | null;
  @ApiProperty({ example: 1 }) attemptCount!: number;
  @ApiProperty({ type: [TestCoverageDto] }) coverage!: TestCoverageDto[];
}

/** `TestSuiteService.createSuite`: suite recién creada con sus casos iniciales. */
export class TestSuiteCreatedDto {
  @ApiProperty({ example: '7001' }) id!: string;
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
  @ApiProperty({ example: 'REGRESSION_V1' }) suiteCode!: string;
  @ApiProperty({ example: 'Regression suite v1' }) name!: string;
  @ApiProperty({ example: 'REGRESSION', enum: ['REGRESSION', 'GOLDEN', 'GENERATED'] })
  suiteType!: string;
  @ApiProperty({ example: true }) isBlocking!: boolean;
  @ApiProperty({ type: [TestCaseRecordDto] }) cases!: TestCaseRecordDto[];
}

/** `TestSuiteService.listSuites`: suite con casos y las 5 corridas más recientes. */
export class TestSuiteWithEvidenceDto extends TestSuiteCreatedDto {
  @ApiProperty({ type: [TestRunSummaryDto], description: 'Las 5 corridas más recientes.' })
  runs!: TestRunSummaryDto[];
}

class TestAssertionDto {
  @ApiProperty({ example: '1' }) id!: string;
  @ApiProperty({ example: 'output.approved_limit' }) assertionPath!: string;
  @ApiProperty({ example: 'EQUALS' }) operator!: string;
  @ApiProperty({ nullable: true }) expectedJson!: unknown;
  @ApiProperty({ nullable: true }) actualJson!: unknown;
  @ApiProperty({ example: true }) passed!: boolean;
}

class TestCaseRunDto {
  @ApiProperty({ example: '8601' }) id!: string;
  @ApiProperty({ example: '8501' }) testRunId!: string;
  @ApiProperty({ example: '8001' }) testCaseId!: string;
  @ApiProperty({ nullable: true }) actualResultJson!: Record<string, unknown> | null;
  @ApiProperty({ example: 'PASSED', enum: ['PASSED', 'FAILED', 'ERROR'] }) resultStatus!: string;
  @ApiProperty({ example: 42 }) durationMs!: number;
  @ApiProperty({ nullable: true }) errorJson!: Record<string, unknown> | null;
  @ApiProperty({ type: TestCaseRecordDto }) testCase!: TestCaseRecordDto;
  @ApiProperty({ type: [TestAssertionDto] }) assertions!: TestAssertionDto[];
}

class TestRunSuiteRefDto {
  @ApiProperty({ example: '7001' }) id!: string;
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
  @ApiProperty({ example: 'REGRESSION_V1' }) suiteCode!: string;
  @ApiProperty({ example: 'Regression suite v1' }) name!: string;
  @ApiProperty({ example: 'REGRESSION' }) suiteType!: string;
  @ApiProperty({ example: true }) isBlocking!: boolean;
}

class TestRunCompiledArtifactRefDto {
  @ApiProperty({ example: '77001' }) id!: string;
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
  @ApiProperty({ example: '1.4.2' }) compilerVersion!: string;
  @ApiProperty({ example: '1.2' }) runtimeSchemaVersion!: string;
  @ApiProperty({ example: 'c3d4e5f6...' }) compiledChecksum!: string;
  @ApiProperty({ example: 'SUCCESS' }) compileStatus!: string;
  @ApiProperty({ example: '2026-07-20T10:05:00.000Z' }) compiledAt!: string;
}

/** `TestExecutionService.enqueueSuite`: corrida recién encolada, sin casos ejecutados aún. */
export class TestRunQueuedDto extends TestRunSummaryDto {
  @ApiProperty({ type: [Object], example: [], description: 'Siempre vacío al encolar.' })
  caseRuns!: [];
}

/** `TestExecutionService.getRun`: corrida con evidencia completa por caso. */
export class TestRunDetailDto {
  @ApiProperty({ example: '8501' }) id!: string;
  @ApiProperty({ example: '7001' }) testSuiteId!: string;
  @ApiProperty({ example: '77001' }) compiledArtifactId!: string;
  @ApiProperty({ example: 'MANUAL' }) triggerType!: string;
  @ApiProperty({ example: 'analyst@atlas.local' }) triggeredBy!: string;
  @ApiProperty({ example: 'SUCCEEDED' }) status!: string;
  @ApiProperty({ example: '2026-07-20T10:00:00.000Z' }) queuedAt!: string;
  @ApiProperty({ nullable: true }) startedAt!: string | null;
  @ApiProperty({ nullable: true }) finishedAt!: string | null;
  @ApiProperty({ nullable: true }) leaseExpiresAt!: string | null;
  @ApiProperty({ example: 1 }) attemptCount!: number;
  @ApiProperty({
    example: 4820,
    description: 'Calculado: `finishedAt` (o ahora) menos `startedAt`.',
  })
  durationMs!: number;
  @ApiProperty({ type: TestRunSuiteRefDto }) testSuite!: TestRunSuiteRefDto;
  @ApiProperty({ type: TestRunCompiledArtifactRefDto })
  compiledArtifact!: TestRunCompiledArtifactRefDto;
  @ApiProperty({ type: [TestCoverageDto] }) coverage!: TestCoverageDto[];
  @ApiProperty({ type: [TestCaseRunDto] }) caseRuns!: TestCaseRunDto[];
}
