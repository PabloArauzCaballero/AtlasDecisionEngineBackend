import type { AuditService } from '../../src/common/audit/audit.service';
import type { MetricsService } from '../../src/common/observability/metrics.service';
import type { PrismaService } from '../../src/common/prisma/prisma.service';
import type { ExecutionEngineService } from '../../src/modules/graph/execution-engine.service';
import { QaCaseObserverService } from '../../src/modules/qa-lab/qa-case-observer.service';
import { QaCompiledArtifactService } from '../../src/modules/qa-lab/qa-compiled-artifact.service';
import { QaCounterexampleStoreService } from '../../src/modules/qa-lab/qa-counterexample-store.service';
import { QaLabService } from '../../src/modules/qa-lab/qa-lab.service';
import type { QaFakersService } from '../../src/modules/qa-lab/qa-fakers.service';
import { QaRunExecutorService } from '../../src/modules/qa-lab/qa-run-executor.service';
import { QaRunHistoryService } from '../../src/modules/qa-lab/qa-run-history.service';
import { QaRunPlannerService } from '../../src/modules/qa-lab/qa-run-planner.service';
import type { VariableResolutionService } from '../../src/modules/variables/variable-resolution.service';

/** Arma el QA Lab con sus colaboradores reales, como lo hace Nest. */
export function buildQaLab(
  prisma: PrismaService,
  audit: AuditService,
  metrics: MetricsService,
  variables: VariableResolutionService,
  engine: ExecutionEngineService,
  fakers?: QaFakersService,
): { lab: QaLabService; history: QaRunHistoryService } {
  const observer = new QaCaseObserverService(variables, engine);
  const history = new QaRunHistoryService(prisma);
  const lab = new QaLabService(
    prisma,
    new QaCompiledArtifactService(prisma),
    new QaRunPlannerService(fakers),
    history,
    new QaRunExecutorService(
      prisma,
      audit,
      metrics,
      observer,
      new QaCounterexampleStoreService(prisma, metrics, observer),
    ),
    observer,
    fakers,
  );
  return { lab, history };
}
