import { Module } from '@nestjs/common';
import { DeploymentModule } from '../deployments/deployment.module';
import { GraphModule } from '../graph/graph.module';
import { NestedTreesModule } from '../nested-trees/nested-trees.module';
import { VariableModule } from '../variables/variable.module';
import { LiveExecutionController } from './live-execution.controller';

@Module({
  imports: [DeploymentModule, GraphModule, VariableModule, NestedTreesModule],
  controllers: [LiveExecutionController],
})
export class LiveExecutionModule {}
