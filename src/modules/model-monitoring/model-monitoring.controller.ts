/** Monitoreo continuo del modelo desplegado (SR 11-7 §V; CMN 4.557 art. 40). */
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import {
  AdverseImpactQueryDto,
  MonitoringWindowQueryDto,
  RecordMonitoringAttributeBatchDto,
  RecordOutcomeBatchDto,
  StabilityQueryDto,
} from './model-monitoring.dto';
import {
  AdverseImpactReportDto,
  MonitoringWriteResultDto,
  PerformanceReportDto,
  StabilityReportDto,
} from './model-monitoring.response.dto';
import { ModelMonitoringService } from './model-monitoring.service';

@ApiTags('Model Monitoring')
@Controller('v1/model-monitoring')
export class ModelMonitoringController {
  constructor(private readonly monitoring: ModelMonitoringService) {}

  /**
   * Carga de desenlaces reales. `OPERATIONS` porque quien la ejecuta es el sistema de
   * cobranza o de confirmación de fraude, no un analista de riesgo.
   */
  @Post('outcomes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record the realized outcome of decisions already taken' })
  @ApiOkResponse({ description: 'Desenlaces registrados.', type: MonitoringWriteResultDto })
  @Roles('OPERATIONS', 'RISK_ANALYST', 'COMPLIANCE')
  recordOutcomes(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: RecordOutcomeBatchDto,
  ) {
    return this.monitoring.recordOutcomes(tenantId, dto, principal);
  }

  /**
   * Atributos que sirven SOLO para medir sesgo.
   *
   * Deliberadamente restringido a `COMPLIANCE`: es el dato que ECOA prohíbe usar al decidir, y
   * quien lo carga no debe ser quien diseña el artefacto. La separación de caminos que hace
   * lícito el autoexamen empieza por quién tiene la llave.
   */
  @Post('attributes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record monitoring-only demographic attributes for bias testing' })
  @ApiOkResponse({ description: 'Atributos registrados.', type: MonitoringWriteResultDto })
  @Roles('COMPLIANCE')
  recordAttributes(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: RecordMonitoringAttributeBatchDto,
  ) {
    return this.monitoring.recordAttributes(tenantId, dto, principal);
  }

  /**
   * `POST` para los tres análisis, y no `GET`, porque llevan ventanas y filtros en el cuerpo;
   * además ninguno es cacheable: su respuesta cambia con cada desenlace que se carga.
   */
  @Post('performance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Outcome analysis: realized rates against the decisions taken' })
  @ApiOkResponse({ description: 'Desempeño observado de la versión.', type: PerformanceReportDto })
  @Roles('RISK_ANALYST', 'COMPLIANCE', 'AUDITOR', 'RISK_APPROVER')
  performance(@TenantId() tenantId: bigint, @Body() query: MonitoringWindowQueryDto) {
    return this.monitoring.performance(tenantId, query);
  }

  @Post('stability')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Population stability index between a reference and current window' })
  @ApiOkResponse({ description: 'Estabilidad poblacional.', type: StabilityReportDto })
  @Roles('RISK_ANALYST', 'COMPLIANCE', 'AUDITOR', 'RISK_APPROVER')
  stability(@TenantId() tenantId: bigint, @Body() query: StabilityQueryDto) {
    return this.monitoring.stability(tenantId, query);
  }

  @Post('adverse-impact')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Adverse impact ratio per group (four-fifths rule)' })
  @ApiOkResponse({ description: 'Razones de impacto adverso.', type: AdverseImpactReportDto })
  @Roles('COMPLIANCE', 'AUDITOR', 'RISK_APPROVER')
  adverseImpact(@TenantId() tenantId: bigint, @Body() query: AdverseImpactQueryDto) {
    return this.monitoring.adverseImpact(tenantId, query);
  }
}
