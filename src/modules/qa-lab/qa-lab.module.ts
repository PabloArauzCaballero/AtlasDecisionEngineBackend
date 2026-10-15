/** QA Lab (§10): generación masiva guiada por contrato, reproducible por semilla. */
import { Module } from '@nestjs/common';
import { GraphModule } from '../graph/graph.module';
import { VariableModule } from '../variables/variable.module';
import { QaFakersModule } from './qa-fakers.module';
import { QaLabController } from './qa-lab.controller';
import { QaCaseObserverService } from './qa-case-observer.service';
import { QaCompiledArtifactService } from './qa-compiled-artifact.service';
import { QaCounterexampleStoreService } from './qa-counterexample-store.service';
import { QaLabService } from './qa-lab.service';
import { QaRunExecutorService } from './qa-run-executor.service';
import { QaRunHistoryService } from './qa-run-history.service';
import { QaRunPlannerService } from './qa-run-planner.service';

@Module({
  imports: [GraphModule, VariableModule, QaFakersModule],
  controllers: [QaLabController],
  providers: [
    QaLabService,
    QaCompiledArtifactService,
    QaRunPlannerService,
    QaRunHistoryService,
    QaRunExecutorService,
    QaCaseObserverService,
    QaCounterexampleStoreService,
  ],
  exports: [QaLabService],
})
export class QaLabModule {}
