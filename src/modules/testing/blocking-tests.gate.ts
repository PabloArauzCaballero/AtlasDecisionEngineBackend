import { Injectable } from '@nestjs/common';
import { TestRunStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { hasExpectation, judgeBlockingSuites } from './blocking-evidence';

@Injectable()
export class BlockingTestsGate {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * La regla vive en `blocking-evidence.ts`; aquí sólo se lee lo que hace falta para aplicarla:
   * por cada suite bloqueante, su corrida TERMINADA más reciente (verde o roja) con su cobertura.
   */
  async verifyBlockingTests(tenantId: bigint, versionId: bigint) {
    const suites = await this.prisma.decisionTestSuite.findMany({
      where: {
        artifactVersionId: versionId,
        isBlocking: true,
        artifactVersion: { artifact: { tenantId } },
      },
      include: {
        runs: {
          where: { status: { in: [TestRunStatus.PASSED, TestRunStatus.FAILED] } },
          orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
          take: 1,
          include: { coverage: true },
        },
        cases: { where: { isActive: true }, select: { expectedResultJson: true } },
      },
    });
    return judgeBlockingSuites(
      suites.map((suite) => {
        const run = suite.runs[0];
        const node = run?.coverage.find((item) => item.coverageType === 'NODE');
        const details = (node?.detailsJson ?? {}) as { covered?: unknown; missing?: unknown };
        const list = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
        return {
          suiteId: suite.id.toString(),
          suiteCode: suite.suiteCode,
          // Sin ningún caso activo que espere algo, la suite no es evidencia de nada.
          assertable: suite.cases.some((item) => hasExpectation(item.expectedResultJson)),
          latestRun: run
            ? {
                id: run.id.toString(),
                status: run.status,
                coveredNodes: list(details.covered),
                missingNodes: list(details.missing),
                nodeCoverage: node ? Number(node.coveragePercentage) : null,
              }
            : null,
        };
      }),
    );
  }
}
