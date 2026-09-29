/** QA Lab: generación masiva guiada por contrato y contraejemplos reproducibles (§10). */
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import { ApiItemsResponse, ApiPagedResponse } from '../../common/http/pagination.dto';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { QA_PROPERTY_CATALOG } from './qa-properties';
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
  @ApiItemsResponse(
    'Catálogo cerrado de propiedades verificadas, cada una con `code`, `label` y `description` en español. No está paginado.',
  )
  @Roles('QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE', 'AUDITOR', 'PLATFORM_ADMIN')
  properties() {
    return { items: QA_PROPERTY_CATALOG };
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
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Lanzar un lote de casos contra una versión compilada',
    description:
      'Responde 202 con la corrida en `RUNNING`: el lote se ejecuta DESPUÉS de la respuesta y hay que consultar `GET runs/{runId}` hasta verla `COMPLETED` o `FAILED`. Ejecutarlo dentro de la petición era imposible: el techo global de `REQUEST_TIMEOUT_MS` (15 s de serie) la cortaba mucho antes que el `timeoutMs` de la propia corrida, que admite hasta 600 000. La semilla, la configuración (devuelta en `config`) y el contrato usado quedan archivados para poder reproducirla. La corrida se evalúa dentro del proceso de la API, sin ambiente y sin persistir ejecuciones: `environmentCode` está obsoleto y se ignora (PROD se sigue rechazando). Los valores con significado —nombre, carnet, celular, correo, ingreso…— salen de los fakers del servidor mock con la misma semilla; si no responde, del generador local, y `fakers.source` lo dice. `distributions` sesga dónde caen los valores de una variable dentro de su rango (§10.4) sin relajar el contrato; `outcomeWeights` reparte la porción VÁLIDA entre los desenlaces del grafo. Una variable o un desenlace que no existan se rechazan en vez de ignorarse.',
  })
  @ApiAcceptedResponse({
    description:
      'Corrida aceptada y en marcha. Los contadores llegan a cero y se van llenando: `configJson.plannedCases` dice cuántos casos se van a ejecutar.',
    type: QaRunDto,
  })
  @Roles('QA_ANALYST', 'FRAUD_ANALYST', 'PLATFORM_ADMIN')
  run(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('versionId') versionId: string,
    @Body() dto: GenerateQaRunDto,
  ) {
    return this.qaLab.run(tenantId, parseBigIntId(versionId, 'versionId'), dto, principal);
  }

  @Get('versions/:versionId/outcomes')
  @ApiOperation({
    summary: 'Desenlaces que alcanza el grafo de una versión',
    description:
      'La lista contra la que se validan las claves de `outcomeWeights`. Sin ella, repartir la porción válida entre ramas obligaría a teclear identificadores de nodo a ciegas y a descubrir el error al lanzar la corrida.',
  })
  @ApiItemsResponse('Desenlaces alcanzables de la versión. No está paginado.')
  // `PLATFORM_ADMIN` va aquí porque puede LANZAR corridas: sin este permiso podría pedir un
  // reparto por desenlace pero no consultar contra qué claves hacerlo.
  @Roles('QA_ANALYST', 'RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE', 'AUDITOR', 'PLATFORM_ADMIN')
  listOutcomes(@TenantId() tenantId: bigint, @Param('versionId') versionId: string) {
    return this.qaLab.listOutcomes(tenantId, parseBigIntId(versionId, 'versionId'));
  }

  @Post('versions/:versionId/sample-inputs')
  @ApiOperation({
    summary: 'Generar valores de prueba de una versión compilada, sin ejecutarlos',
    description:
      'Devuelve entradas derivadas del contrato de la versión para rellenar un caso de prueba a mano. No ejecuta nada ni archiva corrida; la semilla devuelta reproduce el mismo lote. Los valores con significado salen de los fakers del servidor mock (`fakers.source`).',
  })
  @ApiCreatedResponse({
    description: 'Lote de entradas generadas del contrato de la versión.',
    type: VersionSampleInputsDto,
  })
  @Roles('QA_ANALYST', 'FRAUD_ANALYST', 'PLATFORM_ADMIN')
  sampleInputs(
    @TenantId() tenantId: bigint,
    @Param('versionId') versionId: string,
    @Body() dto: GenerateSampleCasesDto,
  ) {
    return this.qaLab.sampleInputs(tenantId, parseBigIntId(versionId, 'versionId'), dto);
  }

  @Post('counterexamples/:counterexampleId/replay')
  @ApiOperation({
    summary: 'Volver a ejecutar un contraejemplo archivado',
    description:
      'Reejecuta la entrada reducida con la CLASE del caso original (válido, frontera o inválido) y, si la propiedad violada es DETERMINISM, varias veces comparando el resultado.',
  })
  @ApiCreatedResponse({ description: 'Resultado de la reproducción.', type: QaReplayResultDto })
  @Roles('QA_ANALYST', 'FRAUD_ANALYST', 'PLATFORM_ADMIN')
  replay(@TenantId() tenantId: bigint, @Param('counterexampleId') counterexampleId: string) {
    return this.qaLab.replay(tenantId, parseBigIntId(counterexampleId, 'counterexampleId'));
  }
}
