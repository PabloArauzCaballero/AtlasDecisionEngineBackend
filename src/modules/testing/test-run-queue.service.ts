import { HttpStatus, Injectable } from '@nestjs/common';
import { TestRunStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { JobName } from '../../common/jobs/job-names';
import { JobSignalService } from '../../common/jobs/job-signal.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { RunTestSuiteDto } from './testing.dto';

@Injectable()
export class TestRunQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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
}
