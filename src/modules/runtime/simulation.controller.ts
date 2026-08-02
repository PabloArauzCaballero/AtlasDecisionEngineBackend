/** Management-only dry-run boundary; PROD is rejected and no decision evidence is persisted. */
import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { SimulatorSampleInputsDto } from '../qa-lab/sample-inputs.response.dto';
import { SampleInputService } from './sample-input.service';
import { GenerateSampleInputsDto, SimulateDecisionDto } from './simulation.dto';
import { SimulationService } from './simulation.service';

@ApiTags('Decision Simulation')
@Controller('v1/simulations')
export class SimulationController {
  constructor(
    private readonly simulations: SimulationService,
    private readonly sampleInputs: SampleInputService,
  ) {}

  @Post(':artifactCode/sample-inputs')
  @ApiOperation({
    summary: 'Generar valores de prueba a partir del contrato de entrada',
    description:
      'Deriva entradas del contrato del artefacto DESPLEGADO en el ambiente pedido, para rellenar el simulador sin teclearlas. No ejecuta ni persiste nada. `kind` elige entre válidas, en el límite del contrato o inválidas a propósito; la semilla devuelta reproduce el mismo lote. PROD se rechaza igual que la simulación.',
  })
  @ApiCreatedResponse({
    description: 'Lote de entradas generadas, con la semilla que las reproduce.',
    type: SimulatorSampleInputsDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST')
  generateSampleInputs(
    @TenantId() tenantId: bigint,
    @Param('artifactCode') artifactCode: string,
    @Body() dto: GenerateSampleInputsDto,
  ) {
    return this.sampleInputs.generate(tenantId, artifactCode, dto);
  }

  @Post(':artifactCode')
  @ApiOperation({
    summary: 'Simulate a SANDBOX or TEST decision without persistence',
    description:
      'With `compareWithProduction: true` the same resolved inputs are also run through the ' +
      'artifact currently deployed to PROD, and the response carries a `productionComparison` ' +
      'block. Nothing is persisted either way; the divergence is counted in ' +
      '`atlas_dev_prod_result_diff_total`.',
  })
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
