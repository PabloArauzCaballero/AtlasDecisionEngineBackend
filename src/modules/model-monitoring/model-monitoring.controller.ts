/** Monitoreo continuo del modelo desplegado (SR 11-7 §V; CMN 4.557 art. 40). */
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import {
  AdverseImpactQueryDto,
  CoverageQueryDto,
  MonitoringWindowQueryDto,
  RecordMonitoringAttributeBatchDto,
  RecordOutcomeBatchDto,
  StabilityQueryDto,
} from './model-monitoring.dto';
import {
  AdverseImpactReportDto,
  DecisionCoverageDto,
  MonitoringWriteResultDto,
  PerformanceReportDto,
  StabilityReportDto,
} from './model-monitoring.response.dto';
import { CutoffAnalysisService } from './cutoff-analysis.service';
import { DecisionCoverageService } from './decision-coverage.service';
import { ModelMonitoringService } from './model-monitoring.service';

@ApiTags('Model Monitoring')
@Controller('v1/model-monitoring')
export class ModelMonitoringController {
  constructor(
    private readonly monitoring: ModelMonitoringService,
    private readonly coverageService: DecisionCoverageService,
    private readonly cutoffs: CutoffAnalysisService,
  ) {}

  /**
   * ¿Está vivo el circuito? Cuántas decisiones llevan solicitante y cuántas ventanas de
   * observación vencidas se cerraron.
   *
   * `GET` y no `POST` como los otros tres análisis, a propósito: aquí los filtros son dos
   * fechas y nada más, así que la pregunta cabe entera en la URL y se puede enlazar, compartir
   * y poner en un tablero. Los otros llevan ventanas de referencia y listas de atributos en el
   * cuerpo, que es de donde venía aquella decisión.
   *
   * Lectura amplia de roles: si medir la salud del sistema de medición exige un permiso
   * escaso, no la mira nadie — y una métrica que nadie mira es la que hizo falta este módulo.
   */
  @Get('coverage')
  @ApiOperation({ summary: 'Coverage of the decision feedback loop: subjects and outcomes' })
  @ApiOkResponse({ description: 'Estado del circuito.', type: DecisionCoverageDto })
  @Roles('RISK_ANALYST', 'COMPLIANCE', 'AUDITOR', 'RISK_APPROVER', 'OPERATIONS')
  coverage(@TenantId() tenantId: bigint, @Query() query: CoverageQueryDto) {
    return this.coverageService.coverage(tenantId, query);
  }

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
   * La curva del punto de corte: que se aprobaria y cuanto se perderia con cada umbral.
   *
   * Es la conversacion que el negocio quiere tener y no podia: sin esta curva, mover un corte es
   * una discusion de opiniones -quien quiere volumen y quien quiere calidad tienen razon por
   * separado- y nadie puede ensenar el intercambio.
   *
   * Es de LECTURA y no propone nada: cambiar el corte sigue siendo cambiar el artefacto y pasar
   * por gobierno. Un control que moviera politica de credito desde una pantalla de analisis seria
   * exactamente lo que este motor existe para evitar.
   */
  @Get('cutoff-analysis')
  @ApiOperation({ summary: 'Approval and loss trade-off at every possible score cutoff' })
  @ApiOkResponse({ description: 'Curva del punto de corte.' })
  @Roles('RISK_ANALYST', 'COMPLIANCE', 'AUDITOR', 'RISK_APPROVER')
  cutoffAnalysis(
    @TenantId() tenantId: bigint,
    @Query('artifactVersionId') artifactVersionId: string,
    @Query('scoreField') scoreField: string,
    @Query('windowDays') windowDays: string,
  ) {
    return this.cutoffs.cutoffCurve(
      tenantId,
      artifactVersionId,
      scoreField || 'score',
      Number(windowDays) || 90,
    );
  }

  /**
   * Champion contra challenger, por DESENLACE observado y no por volumen.
   *
   * El reparto de trafico existia desde hacia tiempo; comparar lo que produce cada rama era lo
   * que faltaba. Sin esto, un experimento reparte pero no concluye — y el sesgo natural es leer
   * la rama con mas decisiones como la mejor, que es justo lo que el reparto 90/10 garantiza.
   */
  @Get('ab')
  @ApiOperation({ summary: 'Champion vs challenger compared by observed outcome' })
  @ApiOkResponse({ description: 'Comparacion entre ramas de trafico.' })
  @Roles('RISK_ANALYST', 'COMPLIANCE', 'AUDITOR', 'RISK_APPROVER')
  abComparison(@TenantId() tenantId: bigint, @Query('deploymentId') deploymentId: string) {
    return this.cutoffs.compareBranches(tenantId, deploymentId);
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
