import { Module } from '@nestjs/common';
import { GraphModule } from '../graph/graph.module';
import { DependencyGraphController, NestedTreeController } from './nested-tree.controller';
import { NestedTreeExecutionService } from './nested-tree-execution.service';
import { NestedTreeService } from './nested-tree.service';

/**
 * Nested decision trees (Fase 7). Depends one-way on GraphModule (for
 * ExecutionEngineService/ExpressionEvaluator, to run and evaluate a referenced
 * child graph). GraphModule has no dependency back on this module — a nested
 * execution's resolver is passed as a plain call argument to `engine.execute()`,
 * never constructor-injected — so there is no circular module dependency.
 */
@Module({
  imports: [GraphModule],
  controllers: [NestedTreeController, DependencyGraphController],
  providers: [NestedTreeService, NestedTreeExecutionService],
  exports: [NestedTreeService, NestedTreeExecutionService],
})
export class NestedTreesModule {}
