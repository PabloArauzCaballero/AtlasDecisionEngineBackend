import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, TestCaseRunStatus, TestRunStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { ExecutionEngineService } from '../graph/execution-engine.service';
import type { CompiledDecisionArtifact } from '../graph/graph.types';
import { VariableResolutionService } from '../variables/variable-resolution.service';
import { RunTestSuiteDto } from './testing.dto';

interface AssertionResult {
  path: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
}

@Injectable()
export class TestExecutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: ExecutionEngineService,
    private readonly variables: VariableResolutionService,
    private readonly audit: AuditService,
  ) {}

  async runSuite(
    tenantId: bigint,
    suiteId: bigint,
    dto: RunTestSuiteDto,
    principal: AuthenticatedPrincipal,
  ) {
    const suite = await this.prisma.decisionTestSuite.findFirst({
      where: { id: suiteId, artifactVersion: { artifact: { tenantId } } },
      include: {
        artifactVersion: { include: { artifact: true } },
        cases: { where: { isActive: true }, orderBy: { caseCode: 'asc' } },
      },
    });
    if (!suite) throw new DomainException('TEST_SUITE_NOT_FOUND', 'Test suite not found', HttpStatus.NOT_FOUND);

    const compiled = dto.compiledArtifactId
      ? await this.prisma.decisionCompiledArtifact.findFirst({
          where: {
            id: BigInt(dto.compiledArtifactId),
            artifactVersionId: suite.artifactVersionId,
          },
        })
      : await this.prisma.decisionCompiledArtifact.findFirst({
          where: { artifactVersionId: suite.artifactVersionId, compileStatus: 'SUCCESS' },
          orderBy: { compiledAt: 'desc' },
        });
    if (!compiled) {
      throw new DomainException('COMPILED_ARTIFACT_NOT_FOUND', 'No compiled artifact is available for this suite', HttpStatus.CONFLICT);
    }
    const payload = compiled.compiledPayloadJson as unknown as CompiledDecisionArtifact;
    const run = await this.prisma.decisionTestRun.create({
      data: {
        testSuiteId: suite.id,
        compiledArtifactId: compiled.id,
        triggerType: dto.triggerType ?? 'MANUAL',
        triggeredBy: principal.id,
        status: TestRunStatus.RUNNING,
      },
    });

    const coveredNodes = new Set<string>();
    const coveredEdges = new Set<string>();
    const coveredTerminals = new Set<string>();
    let failed = false;

    for (const testCase of suite.cases) {
      const started = performance.now();
      let actual: Record<string, unknown> | undefined;
      let error: Record<string, unknown> | undefined;
      let assertions: AssertionResult[] = [];
      let resultStatus: TestCaseRunStatus = TestCaseRunStatus.PASS;
      try {
        const input = testCase.inputJson as Record<string, unknown>;
        const inputVariables = (input.variables ?? input) as Record<string, unknown>;
        const resolution = await this.variables.resolve(payload.variables, inputVariables, {
          tenantId,
          artifactCode: suite.artifactVersion.artifact.artifactCode,
          requestId: `test-${run.id.toString()}-${testCase.caseCode}`,
          allowExternal: false,
        });
        if (!resolution.valid) {
          actual = { outcome: 'NO_DECISION', variableErrors: resolution.errors };
        } else {
          const result = await this.engine.execute(payload, resolution.values);
          actual = {
            ...result.output,
            outcome: result.outcome,
            reasons: result.reasons.map((reason) => reason.code),
            trace: {
              nodes: result.visitedNodeKeys,
              edges: result.traversedEdgeKeys,
              terminal: result.terminalNodeKey,
            },
          };
          result.visitedNodeKeys.forEach((key) => coveredNodes.add(key));
          result.traversedEdgeKeys.forEach((key) => coveredEdges.add(key));
          if (result.terminalNodeKey) coveredTerminals.add(result.terminalNodeKey);
        }
        assertions = this.assertSubset(
          testCase.expectedResultJson as Record<string, unknown>,
          actual,
        );
        if (assertions.some((assertion) => !assertion.passed)) {
          resultStatus = TestCaseRunStatus.FAIL;
          failed = true;
        }
      } catch (caught) {
        failed = true;
        resultStatus = TestCaseRunStatus.ERROR;
        error = {
          message: caught instanceof Error ? caught.message : String(caught),
          name: caught instanceof Error ? caught.name : 'UnknownError',
        };
      }
      const durationMs = Math.max(0, Math.round(performance.now() - started));
      const caseRun = await this.prisma.decisionTestCaseRun.create({
        data: {
          testRunId: run.id,
          testCaseId: testCase.id,
          actualResultJson: actual as Prisma.InputJsonValue | undefined,
          resultStatus,
          durationMs,
          errorJson: error as Prisma.InputJsonValue | undefined,
        },
      });
      if (assertions.length) {
        await this.prisma.decisionTestAssertion.createMany({
          data: assertions.map((assertion) => ({
            testCaseRunId: caseRun.id,
            assertionPath: assertion.path,
            operator: 'EQUALS',
            expectedJson: this.jsonValue(assertion.expected),
            actualJson: this.jsonValue(assertion.actual),
            passed: assertion.passed,
          })),
        });
      }
    }

    const coverage = [
      this.coverageRecord('NODE', coveredNodes, Object.keys(payload.nodes)),
      this.coverageRecord(
        'EDGE',
        coveredEdges,
        Object.values(payload.edgesByNode).flat().map((edge) => edge.key),
      ),
      this.coverageRecord(
        'TERMINAL',
        coveredTerminals,
        Object.values(payload.nodes)
          .filter((node) => node.terminal || node.type === 'END' || node.type === 'MANUAL_REVIEW')
          .map((node) => node.key),
      ),
    ];
    await this.prisma.$transaction(async (tx) => {
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
        },
      });
    });

    await this.audit.append({
      tenantId,
      eventType: failed ? 'TEST_RUN_FAILED' : 'TEST_RUN_PASSED',
      aggregateType: 'TestRun',
      aggregateId: run.id.toString(),
      actorId: principal.id,
      requestId: principal.requestId,
      payload: {
        suiteCode: suite.suiteCode,
        compiledChecksum: compiled.compiledChecksum,
        coverage: coverage.map((item) => ({ type: item.type, percentage: item.percentage })),
      },
    });
    return this.getRun(tenantId, run.id);
  }

  async getRun(tenantId: bigint, runId: bigint) {
    const run = await this.prisma.decisionTestRun.findFirst({
      where: { id: runId, testSuite: { artifactVersion: { artifact: { tenantId } } } },
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
    if (!run) throw new DomainException('TEST_RUN_NOT_FOUND', 'Test run not found', HttpStatus.NOT_FOUND);
    return run;
  }

  async verifyBlockingTests(tenantId: bigint, versionId: bigint): Promise<{
    passed: boolean;
    evidence: Array<Record<string, unknown>>;
  }> {
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
    if (!suites.length) return { passed: false, evidence: [{ reason: 'NO_BLOCKING_TEST_SUITE' }] };
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

  private assertSubset(expected: Record<string, unknown>, actual: Record<string, unknown>, prefix = '$'): AssertionResult[] {
    const results: AssertionResult[] = [];
    for (const [key, expectedValue] of Object.entries(expected)) {
      const path = `${prefix}.${key}`;
      const actualValue = actual?.[key];
      if (
        expectedValue &&
        typeof expectedValue === 'object' &&
        !Array.isArray(expectedValue) &&
        actualValue &&
        typeof actualValue === 'object' &&
        !Array.isArray(actualValue)
      ) {
        results.push(...this.assertSubset(
          expectedValue as Record<string, unknown>,
          actualValue as Record<string, unknown>,
          path,
        ));
      } else {
        results.push({
          path,
          expected: expectedValue,
          actual: actualValue,
          passed: JSON.stringify(expectedValue) === JSON.stringify(actualValue),
        });
      }
    }
    return results;
  }

  private coverageRecord(type: string, covered: Set<string>, totalInput: string[]) {
    const total = [...new Set(totalInput)];
    const coveredValues = total.filter((value) => covered.has(value));
    const missing = total.filter((value) => !covered.has(value));
    return {
      type,
      total,
      covered: coveredValues,
      missing,
      percentage: total.length ? (coveredValues.length / total.length) * 100 : 100,
    };
  }

  private jsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === undefined) return Prisma.JsonNull;
    return value as Prisma.InputJsonValue;
  }
}
