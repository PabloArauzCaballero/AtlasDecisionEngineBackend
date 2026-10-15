/** Campos calculados reutilizables (§5, §6). Reutiliza el sandbox del módulo de grafo. */
import { Module } from '@nestjs/common';
import { GraphModule } from '../graph/graph.module';
import { LibraryModule } from '../libraries/library.module';
import { CalculatedFieldController } from './calculated-field.controller';
import { CalculatedFieldExecutorService } from './calculated-field-executor.service';
import { CalculatedFieldPreviewService } from './calculated-field-preview.service';
import { CalculatedFieldCatalogService } from './calculated-field-catalog.service';
import { CalculatedFieldLoader } from './calculated-field-loader.service';
import { CalculatedFieldTestingService } from './calculated-field-testing.service';
import { CalculatedFieldVersionService } from './calculated-field-version.service';

@Module({
  imports: [GraphModule, LibraryModule],
  controllers: [CalculatedFieldController],
  providers: [
    CalculatedFieldCatalogService,
    CalculatedFieldVersionService,
    CalculatedFieldTestingService,
    CalculatedFieldLoader,
    CalculatedFieldExecutorService,
    CalculatedFieldPreviewService,
  ],
  exports: [CalculatedFieldExecutorService],
})
export class CalculatedFieldsModule {}
