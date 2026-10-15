/** Composes artifact catalog, graph persistence and lifecycle without leaking internals. */
import { Module } from '@nestjs/common';
import { GraphModule } from '../graph/graph.module';
import { ArtifactController } from './artifact.controller';
import { ArtifactGraphReaderService } from './artifact-graph-reader.service';
import { ArtifactGraphWriterService } from './artifact-graph-writer.service';
import { CalculatedFieldBindingService } from './calculated-field-binding.service';
import { ArtifactLifecycleService } from './artifact-lifecycle.service';
import { ArtifactCatalogService } from './artifact-catalog.service';
import { VersionAuthoringService } from './version-authoring.service';
import { VersionCloneService } from './version-clone.service';
import { VersionStateService } from './version-state.service';

@Module({
  imports: [GraphModule],
  controllers: [ArtifactController],
  providers: [
    ArtifactCatalogService,
    VersionAuthoringService,
    VersionCloneService,
    ArtifactGraphReaderService,
    ArtifactGraphWriterService,
    CalculatedFieldBindingService,
    ArtifactLifecycleService,
    VersionStateService,
  ],
  exports: [
    ArtifactCatalogService,
    VersionAuthoringService,
    VersionCloneService,
    ArtifactGraphReaderService,
    ArtifactGraphWriterService,
    ArtifactLifecycleService,
    VersionStateService,
  ],
})
export class ArtifactModule {}
