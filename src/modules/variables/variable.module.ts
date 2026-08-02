/** Exports catalog and resolution services as the engine's shared data-contract authority. */
import { Module } from '@nestjs/common';
import { VariableController } from './variable.controller';
import { VariableService } from './variable.service';
import { VariableResolutionService } from './variable-resolution.service';
import { VariableContractService } from './variable-contract.service';

@Module({
  controllers: [VariableController],
  providers: [VariableService, VariableResolutionService, VariableContractService],
  exports: [VariableService, VariableResolutionService, VariableContractService],
})
export class VariableModule {}
