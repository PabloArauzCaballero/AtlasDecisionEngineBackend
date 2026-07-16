import { Module } from '@nestjs/common';
import { DeploymentModule } from '../deployments/deployment.module';
import { GraphModule } from '../graph/graph.module';
import { VariableModule } from '../variables/variable.module';
import { ExecutionWriterService } from './execution-writer.service';
import { IdempotencyService } from './idempotency.service';
import { RuntimeController } from './runtime.controller';
import { RuntimeService } from './runtime.service';

@Module({
  imports: [DeploymentModule, GraphModule, VariableModule],
  controllers: [RuntimeController],
  providers: [RuntimeService, IdempotencyService, ExecutionWriterService],
  exports: [RuntimeService, IdempotencyService, ExecutionWriterService],
})
export class RuntimeModule {}
