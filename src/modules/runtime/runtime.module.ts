import { Module } from '@nestjs/common';
import { DeploymentModule } from '../deployments/deployment.module';
import { GraphModule } from '../graph/graph.module';
import { NestedTreesModule } from '../nested-trees/nested-trees.module';
import { VariableModule } from '../variables/variable.module';
import { ExecutionWriterService } from './execution-writer.service';
import { IdempotencyService } from './idempotency.service';
import { RetentionSweeperService } from './retention-sweeper.service';
import { RuntimeController } from './runtime.controller';
import { RuntimeService } from './runtime.service';
import { SimulationController } from './simulation.controller';
import { SimulationService } from './simulation.service';

@Module({
  imports: [DeploymentModule, GraphModule, VariableModule, NestedTreesModule],
  controllers: [RuntimeController, SimulationController],
  providers: [
    RuntimeService,
    SimulationService,
    IdempotencyService,
    ExecutionWriterService,
    RetentionSweeperService,
  ],
  exports: [RuntimeService, SimulationService, IdempotencyService, ExecutionWriterService],
})
export class RuntimeModule {}
