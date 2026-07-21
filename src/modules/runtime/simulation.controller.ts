import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
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
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('artifactCode') artifactCode: string,
    @Body() dto: SimulateDecisionDto,
  ) {
    return this.simulations.simulate(tenantId, artifactCode, dto, principal);
  }
}
