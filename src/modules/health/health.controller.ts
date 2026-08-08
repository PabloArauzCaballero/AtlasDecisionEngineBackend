/** Public liveness/readiness endpoints that redact infrastructure detail while retaining diagnostics. */
import { Controller, Get, HttpStatus } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DomainException } from '../../common/errors/domain-exception';
import { DataSourceHealthService } from '../../common/persistence/health/data-source-health.service';
import { Public, SkipRateLimit } from '../../common/security/security.decorators';
import { HealthProbeService } from './health-probe.service';
import { DataSourcesResponseDto, LivenessResponseDto, ReadinessResponseDto } from './health.dto';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(
    private readonly probe: HealthProbeService,
    private readonly dataSourceHealth: DataSourceHealthService,
  ) {}

  @Get('health/live')
  @ApiOperation({
    operationId: 'healthLive',
    summary: 'Report process liveness without checking dependencies',
  })
  @ApiOkResponse({ description: 'El proceso está vivo.', type: LivenessResponseDto })
  @Public()
  @SkipRateLimit()
  live() {
    return this.probe.live();
  }

  // Alias histórico de `/health/live`. Va en su propio método —y no como segunda ruta del
  // anterior— porque dos rutas en un mismo manejador producen dos operaciones OpenAPI con
  // el MISMO operationId, y un cliente generado a partir de ese contrato sobrescribe un
  // método con el otro. Delegar mantiene una sola definición de "vivo".
  @Get('health')
  @ApiOperation({
    operationId: 'healthLiveAlias',
    summary: 'Alias of /health/live kept for existing probes',
  })
  @ApiOkResponse({ description: 'El proceso está vivo.', type: LivenessResponseDto })
  @Public()
  @SkipRateLimit()
  liveAlias() {
    return this.live();
  }

  @Get('health/ready')
  @ApiOperation({
    operationId: 'healthReady',
    summary: 'Report database and cache readiness with redacted failures',
  })
  @ApiOkResponse({ description: 'Todas las dependencias responden.', type: ReadinessResponseDto })
  @ApiServiceUnavailableResponse({ description: 'Alguna dependencia no está disponible.' })
  @Public()
  @SkipRateLimit()
  async ready() {
    const report = await this.probe.ready();
    if (report.ready) {
      return { status: 'ready', checks: report.checks, timestamp: report.timestamp };
    }
    // El detalle del fallo ya quedó en el log del servidor; la respuesta solo lleva qué
    // comprobación falló, porque este endpoint es público.
    throw new DomainException(
      'SERVICE_NOT_READY',
      'One or more required dependencies are unavailable',
      HttpStatus.SERVICE_UNAVAILABLE,
      { checks: report.checks },
    );
  }

  /**
   * Estado de las fuentes de datos y de su enrutamiento.
   *
   * Responde 200 incluso degradado: `/health/ready` es quien decide si el proceso sale de
   * rotación, y esta sonda existe para poder DIAGNOSTICAR cuál de las rutas falla. Un 503
   * aquí escondería justo el cuerpo que se viene a leer.
   */
  @Get('health/data-sources')
  @ApiOperation({
    operationId: 'healthDataSources',
    summary: 'Report registered data connections and their effective routing',
  })
  @ApiOkResponse({
    description: 'Conexiones registradas, su veredicto y las reglas de enrutamiento vigentes.',
    type: DataSourcesResponseDto,
  })
  @Public()
  @SkipRateLimit()
  dataSources() {
    return this.dataSourceHealth.report();
  }

  /** Alias histórico de `/health/ready`; ver la nota de `liveAlias`. */
  @Get('ready')
  @ApiOperation({
    operationId: 'healthReadyAlias',
    summary: 'Alias of /health/ready kept for existing probes',
  })
  @ApiOkResponse({ description: 'Todas las dependencias responden.', type: ReadinessResponseDto })
  @ApiServiceUnavailableResponse({ description: 'Alguna dependencia no está disponible.' })
  @Public()
  @SkipRateLimit()
  readyAlias() {
    return this.ready();
  }
}
