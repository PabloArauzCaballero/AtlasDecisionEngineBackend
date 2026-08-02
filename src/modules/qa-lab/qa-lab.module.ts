/** QA Lab (§10): generación masiva guiada por contrato, reproducible por semilla. */
import { Module } from '@nestjs/common';
import { GraphModule } from '../graph/graph.module';
import { VariableModule } from '../variables/variable.module';
import { QaLabController } from './qa-lab.controller';
import { QaLabService } from './qa-lab.service';

@Module({
  imports: [GraphModule, VariableModule],
  controllers: [QaLabController],
  providers: [QaLabService],
  exports: [QaLabService],
})
export class QaLabModule {}
