import { Module } from '@nestjs/common';
import { GraphModule } from '../graph/graph.module';
import { DependencyGraphController, NestedTreeController } from './nested-tree.controller';
import { NestedTreeExecutionService } from './nested-tree-execution.service';
import { ArtifactReferenceService } from './artifact-reference.service';
import { DependencyGraphService } from './dependency-graph.service';
import { ReferenceChildValidator } from './reference-child-validator.service';
import { ReferenceCycleGuard } from './reference-cycle-guard.service';
import { ReferenceOwnershipService } from './reference-ownership.service';

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
  providers: [
    ArtifactReferenceService,
    DependencyGraphService,
    ReferenceOwnershipService,
    ReferenceChildValidator,
    ReferenceCycleGuard,
    NestedTreeExecutionService,
  ],
  exports: [ArtifactReferenceService, DependencyGraphService, NestedTreeExecutionService],
})
export class NestedTreesModule {}
