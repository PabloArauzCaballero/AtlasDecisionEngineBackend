/** Ingesta del desenlace real y análisis de cosechas. */
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import {
  FacilityOutcomeBatchDto,
  PendingWindowsQueryDto,
  RegisterFacilityBatchDto,
  VintageQueryDto,
} from './outcome-ingestion.dto';
import {
  FacilityRegistrationResultDto,
  OutcomeBatchResultDto,
  PendingWindowsDto,
  VintageMatrixDto,
} from './outcome-ingestion.response.dto';
import { OutcomeIngestionService } from './outcome-ingestion.service';
import { VintageService } from './vintage.service';

@ApiTags('Outcome Ingestion')
@Controller('v1/outcomes')
export class OutcomeIngestionController {
  constructor(
    private readonly ingestion: OutcomeIngestionService,
    private readonly vintages: VintageService,
  ) {}

  /**
   * Alta de créditos concedidos. `OPERATIONS` porque quien la llama es la conciliación diaria
   * con el sistema de cartera, no una persona.
   */
  @Post('facilities')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register disbursed credit facilities and schedule their outcome windows',
  })
  @ApiOkResponse({
    description: 'Créditos registrados, fila a fila.',
    type: FacilityRegistrationResultDto,
  })
  @Roles('OPERATIONS', 'RISK_ANALYST')
  registerFacilities(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: RegisterFacilityBatchDto,
  ) {
    return this.ingestion.registerFacilities(tenantId, dto, principal);
  }

  /**
   * Carga de desenlaces por referencia de crédito.
   *
   * Devuelve el veredicto de CADA fila y no un conteo: un 200 con «1.998 aceptadas» deja al
   * operador sin saber cuáles fueron las dos que no, y la respuesta natural a eso es reenviar
   * el archivo entero y esperar que cuele.
   */
  @Post('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record observed outcomes for known facilities, row by row' })
  @ApiOkResponse({ description: 'Resultado por fila.', type: OutcomeBatchResultDto })
  @Roles('OPERATIONS', 'RISK_ANALYST', 'COMPLIANCE')
  recordBatch(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: FacilityOutcomeBatchDto,
  ) {
    return this.ingestion.recordBatch(tenantId, dto, principal);
  }

  /** La cola de trabajo: ventanas vencidas que nadie observó, la más vieja primero. */
  @Get('pending')
  @ApiOperation({ summary: 'Overdue observation windows nobody has closed' })
  @ApiOkResponse({ description: 'Cola de ventanas vencidas.', type: PendingWindowsDto })
  @Roles('OPERATIONS', 'RISK_ANALYST', 'COMPLIANCE', 'AUDITOR', 'RISK_APPROVER')
  pending(@TenantId() tenantId: bigint, @Query() query: PendingWindowsQueryDto) {
    return this.vintages.pending(tenantId, query);
  }

  /** Matriz cosecha × madurez: la única forma de comparar la política de dos meses. */
  @Get('vintage')
  @ApiOperation({ summary: 'Vintage matrix: bad rate by decision cohort and maturity window' })
  @ApiOkResponse({ description: 'Matriz de cosechas.', type: VintageMatrixDto })
  @Roles('RISK_ANALYST', 'COMPLIANCE', 'AUDITOR', 'RISK_APPROVER')
  vintage(@TenantId() tenantId: bigint, @Query() query: VintageQueryDto) {
    return this.vintages.vintage(tenantId, query);
  }
}
