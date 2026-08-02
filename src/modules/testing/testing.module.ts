/** Composes durable queueing, bounded workers and the real graph execution test path. */
import { Module } from '@nestjs/common';
import { GraphModule } from '../graph/graph.module';
import { NestedTreesModule } from '../nested-trees/nested-trees.module';
import { VariableModule } from '../variables/variable.module';
import { TestingController } from './testing.controller';
import { TestExecutionService } from './test-execution.service';
import { TestCaseExecutorService } from './test-case-executor.service';
import { TestRunWorkerService } from './test-run-worker.service';
import { TestSuiteService } from './test-suite.service';

@Module({
  imports: [GraphModule, VariableModule, NestedTreesModule],
  controllers: [TestingController],
  providers: [
    TestSuiteService,
    TestCaseExecutorService,
    TestExecutionService,
    TestRunWorkerService,
  ],
  exports: [TestSuiteService, TestExecutionService],
})
export class TestingModule {}
