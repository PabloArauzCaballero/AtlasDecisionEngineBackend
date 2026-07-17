import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles, TenantId } from '../../common/security/security.decorators';
import { SimulateDecisionDto } from './simulation.dto';
import { SimulationService } from './simulation.service';

@ApiTags('Decision Simulation')
@Controller('v1/simulations')
export class SimulationController {
  constructor(private readonly simulations: SimulationService) {}

  @Post(':artifactCode')
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST')
  simulate(
    @TenantId() tenantId: bigint,
    @Param('artifactCode') artifactCode: string,
    @Body() dto: SimulateDecisionDto,
  ) {
    return this.simulations.simulate(tenantId, artifactCode, dto);
  }
}
