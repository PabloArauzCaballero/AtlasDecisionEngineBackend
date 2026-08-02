/** Campos calculados reutilizables (§5, §6). Reutiliza el sandbox del módulo de grafo. */
import { Module } from '@nestjs/common';
import { GraphModule } from '../graph/graph.module';
import { LibraryModule } from '../libraries/library.module';
import { CalculatedFieldController } from './calculated-field.controller';
import { CalculatedFieldExecutorService } from './calculated-field-executor.service';
import { CalculatedFieldService } from './calculated-field.service';

@Module({
  imports: [GraphModule, LibraryModule],
  controllers: [CalculatedFieldController],
  providers: [CalculatedFieldService, CalculatedFieldExecutorService],
  exports: [CalculatedFieldService, CalculatedFieldExecutorService],
})
export class CalculatedFieldsModule {}
