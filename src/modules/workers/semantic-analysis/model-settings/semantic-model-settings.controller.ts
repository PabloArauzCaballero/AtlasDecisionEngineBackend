import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Roles } from '../../../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../../../common/security/security.types';
import { OpenRouterCatalogService } from './openrouter-catalog.service';
import { SemanticModelProbeService } from './semantic-model-probe.service';
import {
  OpenRouterCatalogDto,
  SemanticModelProbeDto,
  SemanticModelSettingsDto,
  UpdateSemanticModelSettingsDto,
} from './semantic-model-settings.dto';
import { SemanticModelSettingsService } from './semantic-model-settings.service';

/**
 * Qué gateway y qué modelos atienden el escalón remoto del worker semántico.
 *
 * **Escribir aquí cambia con qué se decide**, como escribir en el catálogo de
 * categorías, y además cambia cuánto cuesta cada glosa. Exige rol de analista
 * de riesgo o de operación: el primero porque gobierna cómo decide el motor,
 * el segundo porque gobierna cuánto gasta. Leer lo puede hacer quien puede
 * ejecutar el worker, porque necesita saber contra qué modelo corre lo que
 * está viendo.
 *
 * La configuración es global por despliegue: no hay `@TenantId()` en las
 * lecturas porque no hay nada que acotar. En las escrituras el tenant del
 * actor sólo sirve para la auditoría.
 */
@ApiTags('Workers · Modelo semántico')
@Controller('v1/workers/semantic-analysis/model-settings')
export class SemanticModelSettingsController {
  constructor(
    private readonly settings: SemanticModelSettingsService,
    private readonly catalog: OpenRouterCatalogService,
    private readonly probe: SemanticModelProbeService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Gateway y modelos en uso, de dónde salen y qué gateways están disponibles',
  })
  @ApiOkResponse({ type: SemanticModelSettingsDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS')
  describe(): Promise<SemanticModelSettingsDto> {
    return this.settings.describe();
  }

  @Put()
  @ApiOperation({ summary: 'Elige el gateway y los modelos del escalón remoto' })
  @ApiOkResponse({ description: 'Configuración aplicada.', type: SemanticModelSettingsDto })
  @Roles('RISK_ANALYST', 'OPERATIONS')
  update(
    @Body() dto: UpdateSemanticModelSettingsDto,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<SemanticModelSettingsDto> {
    return this.settings.update(dto, principal);
  }

  @Delete()
  @ApiOperation({ summary: 'Vuelve a lo que dicta el entorno' })
  @ApiOkResponse({
    description: 'Configuración del entorno, ya en vigor.',
    type: SemanticModelSettingsDto,
  })
  @Roles('RISK_ANALYST', 'OPERATIONS')
  reset(@CurrentPrincipal() principal: AuthenticatedPrincipal): Promise<SemanticModelSettingsDto> {
    return this.settings.reset(principal);
  }

  @Get('catalog')
  @ApiOperation({ summary: 'Modelos de OpenRouter que sostienen salida estructurada, con precio' })
  @ApiOkResponse({ type: OpenRouterCatalogDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'OPERATIONS')
  listCatalog(): Promise<OpenRouterCatalogDto> {
    return this.catalog.list();
  }

  /**
   * Gasta lo que cuestan dos glosas y no guarda nada. Por eso exige el mismo
   * rol que guardar: es la única forma de que alguien sin ese rol no pueda
   * gastar créditos a discreción.
   */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Clasifica una glosa de prueba con la configuración candidata, sin guardarla',
  })
  @ApiOkResponse({ type: SemanticModelProbeDto })
  @Roles('RISK_ANALYST', 'OPERATIONS')
  test(@Body() dto: UpdateSemanticModelSettingsDto): Promise<SemanticModelProbeDto> {
    return this.probe.probe(dto);
  }
}
