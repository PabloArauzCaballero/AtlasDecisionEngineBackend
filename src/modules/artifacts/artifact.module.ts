/** Composes artifact catalog, graph persistence and lifecycle without leaking internals. */
import { Module } from '@nestjs/common';
import { GraphModule } from '../graph/graph.module';
import { ArtifactController } from './artifact.controller';
import { ArtifactGraphReaderService } from './artifact-graph-reader.service';
import { ArtifactGraphWriterService } from './artifact-graph-writer.service';
import { CalculatedFieldBindingService } from './calculated-field-binding.service';
import { ArtifactLifecycleService } from './artifact-lifecycle.service';
import { ArtifactService } from './artifact.service';
import { VersionStateService } from './version-state.service';

@Module({
  imports: [GraphModule],
  controllers: [ArtifactController],
  providers: [
    ArtifactService,
    ArtifactGraphReaderService,
    ArtifactGraphWriterService,
    CalculatedFieldBindingService,
    ArtifactLifecycleService,
    VersionStateService,
  ],
  exports: [
    ArtifactService,
    ArtifactGraphReaderService,
    ArtifactGraphWriterService,
    ArtifactLifecycleService,
    VersionStateService,
  ],
})
export class ArtifactModule {}
