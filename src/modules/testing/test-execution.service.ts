import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TestCaseRunStatus, TestRunStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { JobName } from '../../common/jobs/job-names';
import { JobSignalService } from '../../common/jobs/job-signal.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import type { CompiledDecisionArtifact } from '../graph/graph.types';
import { TestCaseExecutorService, type EvaluatedTestCase } from './test-case-executor.service';
import { RunTestSuiteDto } from './testing.dto';

@Injectable()
export class TestExecutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly caseExecutor: TestCaseExecutorService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly jobSignal: JobSignalService,
  ) {}

  /** Persists a durable job and returns immediately; workers claim it independently. */
  async enqueueSuite(
    tenantId: bigint,
    suiteId: bigint,
    dto: RunTestSuiteDto,
    principal: AuthenticatedPrincipal,
  ) {
    if (dto.baselineCompiledArtifactId) {
      // Silently ignoring a requested baseline would create false regression evidence.
      throw new DomainException(
        'BASELINE_COMPARISON_NOT_SUPPORTED',
        'Baseline comparison is not available; omit baselineCompiledArtifactId and use explicit expected results',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const suite = await this.prisma.decisionTestSuite.findFirst({
      where: { id: suiteId, artifactVersion: { artifact: { tenantId } } },
      select: { id: true, artifactVersionId: true, suiteCode: true },
    });
    if (!suite) {
      throw new DomainException(
        'TEST_SUITE_NOT_FOUND',
        'Test suite not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const compiled = dto.compiledArtifactId
      ? await this.prisma.decisionCompiledArtifact.findFirst({
          where: {
            id: parseBigIntId(dto.compiledArtifactId, 'compiledArtifactId'),
            artifactVersionId: suite.artifactVersionId,
            compileStatus: 'SUCCESS',
          },
        })
      : await this.prisma.decisionCompiledArtifact.findFirst({
          where: {
            artifactVersionId: suite.artifactVersionId,
            compileStatus: 'SUCCESS',
          },
          orderBy: { compiledAt: 'desc' },
        });
    if (!compiled) {
      throw new DomainException(
        'COMPILED_ARTIFACT_NOT_FOUND',
        'No compiled artifact is available for this suite',
        HttpStatus.CONFLICT,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const run = await tx.decisionTestRun.create({
        data: {
          testSuiteId: suite.id,
          compiledArtifactId: compiled.id,
          triggerType: dto.triggerType ?? 'MANUAL',
          triggeredBy: principal.id,
          status: TestRunStatus.QUEUED,
        },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'TEST_RUN_QUEUED',
          aggregateType: 'TestRun',
          aggregateId: run.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            suiteCode: suite.suiteCode,
            compiledChecksum: compiled.compiledChecksum,
          },
        },
        tx,
      );
      // Despierta al worker en el commit. Va DENTRO de la transacción a propósito: Postgres
      // solo entrega el aviso si esta transacción confirma, así que el worker nunca busca una
      // corrida que se deshizo, y nunca la busca antes de que sea visible.
      await this.jobSignal.notify(tx, JobName.TestRun);
      return { ...run, caseRuns: [], coverage: [], durationMs: 0 };
    });
  }

  /** Executes one job already claimed by TestRunWorkerService. */
  async executeQueuedRun(runId: bigint): Promise<void> {
    const run = await this.prisma.decisionTestRun.findUnique({
      where: { id: runId },
      include: {
        testSuite: {
          include: {
            artifactVersion: { include: { artifact: true } },
            cases: { where: { isActive: true }, orderBy: { caseCode: 'asc' } },
          },
        },
        compiledArtifact: true,
      },
    });
    if (!run || run.status !== TestRunStatus.RUNNING) {
      throw new DomainException(
        'TEST_RUN_NOT_CLAIMED',
        'Test run is missing or has not been claimed',
        HttpStatus.CONFLICT,
      );
    }

    const payload = run.compiledArtifact.compiledPayloadJson as unknown as CompiledDecisionArtifact;
    const tenantId = run.testSuite.artifactVersion.artifact.tenantId;
    const artifactCode = run.testSuite.artifactVersion.artifact.artifactCode;
    const concurrency = this.config.get<number>('TEST_CASE_CONCURRENCY') ?? 4;
    const evaluated = await this.mapWithConcurrency(run.testSuite.cases, concurrency, (testCase) =>
      this.caseExecutor.execute({
        tenantId,
        artifactCode,
        runId,
        payload,
        testCase,
      }),
    );

    const coveredNodes = new Set(evaluated.flatMap((item) => item.visitedNodeKeys));
    const coveredEdges = new Set(evaluated.flatMap((item) => item.traversedEdgeKeys));
    const coveredTerminals = new Set(
      evaluated.flatMap((item) => (item.terminalNodeKey ? [item.terminalNodeKey] : [])),
    );
    const coverage = [
      this.coverageRecord('NODE', coveredNodes, Object.keys(payload.nodes)),
      this.coverageRecord(
        'EDGE',
        coveredEdges,
        Object.values(payload.edgesByNode)
          .flat()
          .map((edge) => edge.key),
      ),
      this.coverageRecord(
        'TERMINAL',
        coveredTerminals,
        Object.values(payload.nodes)
          .filter((node) => node.terminal || node.type === 'END' || node.type === 'MANUAL_REVIEW')
          .map((node) => node.key),
      ),
    ];
    const failed = evaluated.some((item) => item.resultStatus !== TestCaseRunStatus.PASS);

    await this.prisma.$transaction(async (tx) => {
      const caseRuns = await tx.decisionTestCaseRun.createManyAndReturn({
        data: evaluated.map((item) => ({
          testRunId: run.id,
          testCaseId: item.testCaseId,
          actualResultJson: this.jsonValue(item.actual),
          resultStatus: item.resultStatus,
          durationMs: item.durationMs,
          errorJson: this.jsonValue(item.error),
        })),
      });
      const caseRunIds = new Map(caseRuns.map((item) => [item.testCaseId.toString(), item.id]));
      const assertions = evaluated.flatMap((item) =>
        item.assertions.map((assertion) => ({
          testCaseRunId: caseRunIds.get(item.testCaseId.toString()) as bigint,
          assertionPath: assertion.path,
          operator: 'EQUALS',
          expectedJson: this.jsonValue(assertion.expected),
          actualJson: this.jsonValue(assertion.actual),
          passed: assertion.passed,
        })),
      );
      if (assertions.length) await tx.decisionTestAssertion.createMany({ data: assertions });
      await tx.decisionTestCoverage.createMany({
        data: coverage.map((item) => ({
          testRunId: run.id,
          coverageType: item.type,
          coveredCount: item.covered.length,
          totalCount: item.total.length,
          coveragePercentage: item.percentage,
          detailsJson: { covered: item.covered, missing: item.missing },
        })),
      });
      await tx.decisionTestRun.update({
        where: { id: run.id },
        data: {
          status: failed ? TestRunStatus.FAILED : TestRunStatus.PASSED,
          finishedAt: new Date(),
          leaseExpiresAt: null,
        },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: failed ? 'TEST_RUN_FAILED' : 'TEST_RUN_PASSED',
          aggregateType: 'TestRun',
          aggregateId: run.id.toString(),
          actorId: run.triggeredBy,
          requestId: `test-run-${run.id.toString()}`,
          payload: {
            suiteCode: run.testSuite.suiteCode,
            compiledChecksum: run.compiledArtifact.compiledChecksum,
            coverage: coverage.map((item) => ({
              type: item.type,
              percentage: item.percentage,
            })),
          },
        },
        tx,
      );
    });
  }

  async getRun(tenantId: bigint, runId: bigint) {
    const run = await this.prisma.decisionTestRun.findFirst({
      where: {
        id: runId,
        testSuite: { artifactVersion: { artifact: { tenantId } } },
      },
      include: {
        testSuite: true,
        compiledArtifact: true,
        coverage: true,
        caseRuns: {
          include: { testCase: true, assertions: true },
          orderBy: { testCase: { caseCode: 'asc' } },
        },
      },
    });
    if (!run) {
      throw new DomainException('TEST_RUN_NOT_FOUND', 'Test run not found', HttpStatus.NOT_FOUND);
    }
    const end = run.finishedAt ?? new Date();
    const durationMs = run.startedAt ? Math.max(0, end.getTime() - run.startedAt.getTime()) : 0;
    return { ...run, durationMs };
  }

  async verifyBlockingTests(tenantId: bigint, versionId: bigint) {
    const suites = await this.prisma.decisionTestSuite.findMany({
      where: {
        artifactVersionId: versionId,
        isBlocking: true,
        artifactVersion: { artifact: { tenantId } },
      },
      include: {
        runs: {
          where: { status: TestRunStatus.PASSED },
          orderBy: { startedAt: 'desc' },
          take: 1,
          include: { coverage: true },
        },
      },
    });
    if (!suites.length) {
      return {
        passed: false,
        evidence: [{ reason: 'NO_BLOCKING_TEST_SUITE' }],
      };
    }
    const evidence = suites.map((suite) => {
      const run = suite.runs[0];
      const nodeCoverage = run?.coverage.find((item) => item.coverageType === 'NODE');
      return {
        suiteId: suite.id.toString(),
        suiteCode: suite.suiteCode,
        latestPassingRunId: run?.id.toString() ?? null,
        nodeCoverage: nodeCoverage ? Number(nodeCoverage.coveragePercentage) : null,
        passed: Boolean(run) && Number(nodeCoverage?.coveragePercentage ?? 0) >= 80,
      };
    });
    return { passed: evidence.every((item) => item.passed), evidence };
  }

  private coverageRecord(type: string, covered: Set<string>, totalInput: string[]) {
    const total = [...new Set(totalInput)];
    const coveredValues = total.filter((value) => covered.has(value));
    return {
      type,
      total,
      covered: coveredValues,
      missing: total.filter((value) => !covered.has(value)),
      percentage: total.length ? (coveredValues.length / total.length) * 100 : 100,
    };
  }

  private jsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    return value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
  }

  private async mapWithConcurrency<T, R>(
    values: T[],
    concurrency: number,
    mapper: (value: T) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(values.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        results[index] = await mapper(values[index] as T);
      }
    });
    await Promise.all(workers);
    return results;
  }
}
