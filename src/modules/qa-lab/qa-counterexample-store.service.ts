import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { MetricsService } from '../../common/observability/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CompiledDecisionArtifact } from '../graph/graph.types';
import type { GeneratedCase } from './contract-generator';
import { QaCaseObserverService } from './qa-case-observer.service';
import { shrinkCounterexample, type PropertyViolation } from './qa-properties';

/** Reduce a su mínima expresión un caso que violó una propiedad y lo archiva para reproducirlo. */
@Injectable()
export class QaCounterexampleStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly observer: QaCaseObserverService,
  ) {}

  async store(
    tenantId: bigint,
    runId: bigint,
    seed: string,
    compiled: CompiledDecisionArtifact,
    testCase: GeneratedCase,
    violation: PropertyViolation,
  ) {
    const stillFails = async (candidate: Record<string, unknown>): Promise<boolean> => {
      try {
        const violations = await this.observer.violationsOf(
          tenantId,
          compiled,
          testCase.kind,
          candidate,
          violation.property === 'DETERMINISM',
        );
        return violations.some((entry) => entry.failureCode === violation.failureCode);
      } catch {
        return false;
      }
    };
    const shrunk = await shrinkCounterexample(testCase.input, stillFails);

    const created = await this.prisma.qaCounterexample.create({
      data: {
        tenantId,
        qaRunId: runId,
        property: violation.property,
        shrunkInputJson: shrunk as Prisma.InputJsonValue,
        originalInputJson: testCase.input as Prisma.InputJsonValue,
        observedJson: (violation.observed ?? null) as Prisma.InputJsonValue,
        failureCode: violation.failureCode,
        failureMessage: violation.failureMessage,
        replaySeed: seed,
        replayPath: `${testCase.index}/${testCase.kind}${testCase.mutation ? `/${testCase.mutation}` : ''}`,
      },
    });
    this.metrics.recordQaCounterexample(violation.property);
    return {
      id: created.id.toString(),
      property: created.property,
      failureCode: created.failureCode,
      failureMessage: created.failureMessage,
      shrunkInput: shrunk,
      replaySeed: seed,
      replayPath: created.replayPath,
    };
  }
}
