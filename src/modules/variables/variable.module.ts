import { Module } from '@nestjs/common';
import { VariableController } from './variable.controller';
import { VariableService } from './variable.service';
import { VariableResolutionService } from './variable-resolution.service';

@Module({
  controllers: [VariableController],
  providers: [VariableService, VariableResolutionService],
  exports: [VariableService, VariableResolutionService],
})
export class VariableModule {}
