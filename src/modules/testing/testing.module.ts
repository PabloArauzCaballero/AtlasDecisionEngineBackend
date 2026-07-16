import { Module } from '@nestjs/common';
import { GraphModule } from '../graph/graph.module';
import { VariableModule } from '../variables/variable.module';
import { TestingController } from './testing.controller';
import { TestExecutionService } from './test-execution.service';
import { TestSuiteService } from './test-suite.service';

@Module({
  imports: [GraphModule, VariableModule],
  controllers: [TestingController],
  providers: [TestSuiteService, TestExecutionService],
  exports: [TestSuiteService, TestExecutionService],
})
export class TestingModule {}
