/** Public liveness/readiness endpoints that redact infrastructure detail while retaining diagnostics. */
import { Controller, Get, HttpStatus } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DomainException } from '../../common/errors/domain-exception';
import { Public, SkipRateLimit } from '../../common/security/security.decorators';
import { HealthProbeService } from './health-probe.service';
import { LivenessResponseDto, ReadinessResponseDto } from './health.dto';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(private readonly probe: HealthProbeService) {}

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
