import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TestCaseRunStatus, TestRunStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CompiledDecisionArtifact } from '../graph/graph.types';
import { TestCaseExecutorService } from './test-case-executor.service';

@Injectable()
export class TestRunExecutor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly caseExecutor: TestCaseExecutorService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

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
        results[index] = await mapper(values[index]);
      }
    });
    await Promise.all(workers);
    return results;
  }
}
