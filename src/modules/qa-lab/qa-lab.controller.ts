/** QA Lab: generación masiva guiada por contrato y contraejemplos reproducibles (§10). */
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import { ApiItemsResponse, ApiPagedResponse } from '../../common/http/pagination.dto';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { QA_PROPERTIES } from './qa-properties';
import { GenerateQaRunDto, GenerateSampleCasesDto, QaRunQueryDto } from './qa-lab.dto';
import { QaRunDto, QaRunListItemDto, QaReplayResultDto } from './qa-lab.response.dto';
import { VersionSampleInputsDto } from './sample-inputs.response.dto';
import { QaLabService } from './qa-lab.service';

@ApiTags('QA Lab')
@Controller('v1/qa-lab')
export class QaLabController {
  constructor(private readonly qaLab: QaLabService) {}

  @Get('properties')
  @ApiOperation({ summary: 'Propiedades que el QA Lab verifica en cada ejecución' })
  @ApiItemsResponse('Catálogo cerrado de propiedades verificadas. No está paginado.')
  @Roles('QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE', 'AUDITOR', 'PLATFORM_ADMIN')
  properties() {
    return { items: QA_PROPERTIES };
  }

  @Get('runs')
  @ApiOperation({ summary: 'Historial de corridas generativas' })
  @ApiPagedResponse('Página de corridas generativas del tenant.', QaRunListItemDto)
  @Roles('QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE', 'AUDITOR')
  listRuns(@TenantId() tenantId: bigint, @Query() query: QaRunQueryDto) {
    return this.qaLab.listRuns(tenantId, query);
  }

  @Get('runs/:runId')
  @ApiOperation({ summary: 'Detalle de una corrida con sus contraejemplos mínimos' })
  @ApiOkResponse({ description: 'Corrida con sus contraejemplos completos.', type: QaRunDto })
  @Roles('QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE', 'AUDITOR')
  getRun(@TenantId() tenantId: bigint, @Param('runId') runId: string) {
    return this.qaLab.getRun(tenantId, parseBigIntId(runId, 'runId'));
  }

  @Post('versions/:versionId/runs')
  @ApiOperation({
    summary: 'Generar y ejecutar un lote de casos contra una versión compilada',
    description:
      'La semilla, la configuración y el contrato usado quedan archivados para poder reproducir la corrida. PROD no está permitido. `distributions` sesga dónde caen los valores de una variable dentro de su rango (§10.4) sin relajar el contrato; una variable ajena al contrato de entradas se rechaza en vez de ignorarse.',
  })
  @ApiCreatedResponse({
    description: 'Corrida completada, con sus contraejemplos.',
    type: QaRunDto,
  })
  @Roles('QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST', 'PLATFORM_ADMIN')
  run(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('versionId') versionId: string,
    @Body() dto: GenerateQaRunDto,
  ) {
    return this.qaLab.run(tenantId, parseBigIntId(versionId, 'versionId'), dto, principal);
  }

  @Post('versions/:versionId/sample-inputs')
  @ApiOperation({
    summary: 'Generar valores de prueba de una versión compilada, sin ejecutarlos',
    description:
      'Devuelve entradas derivadas del contrato de la versión para rellenar un caso de prueba a mano. No ejecuta nada ni archiva corrida; la semilla devuelta reproduce el mismo lote.',
  })
  @ApiCreatedResponse({
    description: 'Lote de entradas generadas del contrato de la versión.',
    type: VersionSampleInputsDto,
  })
  @Roles('QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST', 'PLATFORM_ADMIN')
  sampleInputs(
    @TenantId() tenantId: bigint,
    @Param('versionId') versionId: string,
    @Body() dto: GenerateSampleCasesDto,
  ) {
    return this.qaLab.sampleInputs(tenantId, parseBigIntId(versionId, 'versionId'), dto);
  }

  @Post('counterexamples/:counterexampleId/replay')
  @ApiOperation({ summary: 'Volver a ejecutar un contraejemplo archivado' })
  @ApiCreatedResponse({ description: 'Resultado de la reproducción.', type: QaReplayResultDto })
  @Roles('QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST', 'PLATFORM_ADMIN')
  replay(@TenantId() tenantId: bigint, @Param('counterexampleId') counterexampleId: string) {
    return this.qaLab.replay(tenantId, parseBigIntId(counterexampleId, 'counterexampleId'));
  }
}
