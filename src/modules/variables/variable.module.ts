/** Exports catalog and resolution services as the engine's shared data-contract authority. */
import { Module } from '@nestjs/common';
import { VariableController } from './variable.controller';
import { ReasonCodeService } from './reason-code.service';
import { VariableDefinitionService } from './variable-definition.service';
import { VariableQueryService } from './variable-query.service';
import { VariableResolutionService } from './variable-resolution.service';
import { VariableContractService } from './variable-contract.service';

@Module({
  controllers: [VariableController],
  providers: [
    VariableDefinitionService,
    VariableQueryService,
    ReasonCodeService,
    VariableResolutionService,
    VariableContractService,
  ],
  exports: [VariableResolutionService, VariableContractService],
})
export class VariableModule {}
