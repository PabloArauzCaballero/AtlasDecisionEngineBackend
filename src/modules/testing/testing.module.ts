/** Composes durable queueing, bounded workers and the real graph execution test path. */
import { Module } from '@nestjs/common';
import { GraphModule } from '../graph/graph.module';
import { NestedTreesModule } from '../nested-trees/nested-trees.module';
import { WorkersModule } from '../workers/workers.module';
import { VariableModule } from '../variables/variable.module';
import { CoverageSuiteService } from './coverage-suite.service';
import { TestingController } from './testing.controller';
import { BlockingTestsGate } from './blocking-tests.gate';
import { TestRunExecutor } from './test-run-executor.service';
import { TestRunQueueService } from './test-run-queue.service';
import { TestCaseExecutorService } from './test-case-executor.service';
import { TestRunWorkerService } from './test-run-worker.service';
import { TestSuiteService } from './test-suite.service';

@Module({
  imports: [GraphModule, VariableModule, NestedTreesModule, WorkersModule],
  controllers: [TestingController],
  providers: [
    TestSuiteService,
    CoverageSuiteService,
    TestCaseExecutorService,
    TestRunQueueService,
    TestRunExecutor,
    BlockingTestsGate,
    TestRunWorkerService,
  ],
  exports: [TestSuiteService, BlockingTestsGate],
})
export class TestingModule {}
