/** API de campos calculados reutilizables (§5, §6). */
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { CurrentPrincipal, Roles, TenantId } from '../../common/security/security.decorators';
import { ApiPagedResponse } from '../../common/http/pagination.dto';
import { VersionSampleInputsDto } from '../qa-lab/sample-inputs.response.dto';
import {
  CalculatedFieldCreatedDto,
  CalculatedFieldDetailDto,
  CalculatedFieldListItemDto,
  CalculatedFieldPromotedDto,
  CalculatedFieldOutcomeCoverageReportDto,
  CalculatedFieldPreviewTryRunDto,
  CalculatedFieldTestReportDto,
  CalculatedFieldTryRunDto,
  CalculatedFieldVersionCreatedDto,
  OperationCatalogDto,
} from './calculated-field.response.dto';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { OPERATIONS, OPERATION_CATEGORIES } from './operation-catalog';
import { MAX_EXECUTABLE_LINES } from './code-guard';
import {
  CalculatedFieldOutcomeCoverageDto,
  CalculatedFieldQueryDto,
  CreateCalculatedFieldDto,
  CreateCalculatedFieldVersionDto,
  PreviewOutcomeCoverageDto,
  PreviewCalculatedFieldDto,
  PreviewSampleCalculatedFieldInputsDto,
  PreviewTryCalculatedFieldDto,
  PromoteCalculatedFieldVersionDto,
  TryCalculatedFieldDto,
  SampleCalculatedFieldInputsDto,
} from './calculated-field.dto';
import { CalculatedFieldPreviewService } from './calculated-field-preview.service';
import { CalculatedFieldService } from './calculated-field.service';

@ApiTags('Calculated Fields')
@Controller('v1/calculated-fields')
export class CalculatedFieldController {
  constructor(
    private readonly fields: CalculatedFieldService,
    private readonly preview: CalculatedFieldPreviewService,
  ) {}

  @Get('operations')
  @ApiOperation({ summary: 'Catálogo de operaciones del constructor visual' })
  @ApiOkResponse({
    description:
      'Catálogo CERRADO de operaciones visuales y el máximo de líneas ejecutables que el guardián de código admite.',
    type: OperationCatalogDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR', 'PLATFORM_ADMIN')
  operations() {
    return {
      categories: OPERATION_CATEGORIES,
      operations: OPERATIONS,
      maxExecutableLines: MAX_EXECUTABLE_LINES,
    };
  }

  /*
   * Ensayo de un BORRADOR (`preview/…`). Se declaran antes que `:fieldId/versions` para
   * que ninguna ruta con parámetro pueda reclamar estos caminos si alguien reordena.
   *
   * Los tres que EJECUTAN piden los mismos roles que crear una versión, no los de
   * probar una: ejecutar una versión guardada corre código que un autor ya escribió y
   * el gobierno revisó, mientras que ensayar corre el código que venga en el cuerpo.
   * Dárselo a quien sólo puede probar sería regalarle un intérprete.
   */
  @Post('preview/try')
  @ApiOperation({
    summary: 'Ejecutar un borrador de versión sin crearlo',
    description:
      'Recibe el mismo cuerpo que crearía la versión y lo ejecuta en el sandbox real. No persiste nada. Si el contrato no es válido responde 400 con la lista completa de incumplimientos, la misma que devolvería el guardado.',
  })
  @ApiCreatedResponse({
    description: 'Resultado de la ejecución de prueba del borrador.',
    type: CalculatedFieldPreviewTryRunDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'PLATFORM_ADMIN')
  previewTry(@TenantId() tenantId: bigint, @Body() dto: PreviewTryCalculatedFieldDto) {
    return this.preview.tryRun(tenantId, dto.definition, dto.inputs);
  }

  @Post('preview/sample-inputs')
  @ApiOperation({
    summary: 'Generar entradas de ejemplo de un borrador, sin ejecutarlas',
    description:
      'Mismo generador que el QA Lab. No exige que el contrato esté completo: generar valores para unas entradas ya declaradas es justo lo que se hace mientras la fórmula está a medias.',
  })
  @ApiCreatedResponse({
    description: 'Lote de entradas generadas, con la semilla que las reproduce.',
    type: VersionSampleInputsDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'PLATFORM_ADMIN')
  previewSampleInputs(@Body() dto: PreviewSampleCalculatedFieldInputsDto) {
    return this.preview.samplesOf(dto.definition.inputs, dto);
  }

  @Post('preview/test')
  @ApiOperation({
    summary: 'Ejecutar los casos de prueba declarados en el borrador',
    description: 'Los casos viajan en el cuerpo; no se guarda ninguno.',
  })
  @ApiCreatedResponse({
    description: 'Informe de los casos declarados en el borrador.',
    type: CalculatedFieldTestReportDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'PLATFORM_ADMIN')
  previewTest(@TenantId() tenantId: bigint, @Body() dto: PreviewCalculatedFieldDto) {
    return this.preview.runTestCases(tenantId, dto.definition);
  }

  @Post('preview/outcomes')
  @ApiOperation({
    summary: 'Qué desenlaces del contrato alcanza un borrador',
    description:
      'Genera casos válidos, de frontera e inválidos, los EJECUTA y agrupa por desenlace. Informa también de los desenlaces declarados que ningún caso alcanzó, y de los que el contrato no puede producir nunca.',
  })
  @ApiCreatedResponse({
    description: 'Cobertura de desenlaces del borrador.',
    type: CalculatedFieldOutcomeCoverageReportDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'PLATFORM_ADMIN')
  previewOutcomes(@TenantId() tenantId: bigint, @Body() dto: PreviewOutcomeCoverageDto) {
    return this.preview.outcomeCoverage(tenantId, dto.definition, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar campos calculados' })
  @ApiPagedResponse('Página de campos calculados del tenant.', CalculatedFieldListItemDto)
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR')
  list(@TenantId() tenantId: bigint, @Query() query: CalculatedFieldQueryDto) {
    return this.fields.list(tenantId, query);
  }

  @Get(':fieldId')
  @ApiOperation({ summary: 'Detalle de un campo calculado con todas sus versiones' })
  @ApiOkResponse({
    description: 'Campo con todas sus versiones y su evidencia de uso.',
    type: CalculatedFieldDetailDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'COMPLIANCE', 'AUDITOR')
  get(@TenantId() tenantId: bigint, @Param('fieldId') fieldId: string) {
    return this.fields.get(tenantId, parseBigIntId(fieldId, 'fieldId'));
  }

  @Post()
  @ApiOperation({ summary: 'Crear un campo calculado' })
  @ApiCreatedResponse({ description: 'Campo creado.', type: CalculatedFieldCreatedDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'PLATFORM_ADMIN')
  create(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() dto: CreateCalculatedFieldDto,
  ) {
    return this.fields.create(tenantId, dto, principal);
  }

  @Post(':fieldId/versions')
  @ApiOperation({
    summary: 'Crear una versión con su contrato de retorno e implementación',
    description:
      'El código JavaScript o Python no puede superar tres líneas ejecutables; los comentarios viajan aparte.',
  })
  @ApiCreatedResponse({
    description: 'Versión creada en DRAFT.',
    type: CalculatedFieldVersionCreatedDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'PLATFORM_ADMIN')
  createVersion(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('fieldId') fieldId: string,
    @Body() dto: CreateCalculatedFieldVersionDto,
  ) {
    return this.fields.createVersion(tenantId, parseBigIntId(fieldId, 'fieldId'), dto, principal);
  }

  @Post('versions/:versionId/promote')
  @ApiOperation({ summary: 'Promover una versión en su ciclo de gobierno' })
  @ApiCreatedResponse({ description: 'Versión promovida.', type: CalculatedFieldPromotedDto })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'COMPLIANCE', 'PLATFORM_ADMIN')
  promote(
    @TenantId() tenantId: bigint,
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param('versionId') versionId: string,
    @Body() dto: PromoteCalculatedFieldVersionDto,
  ) {
    return this.fields.promote(tenantId, parseBigIntId(versionId, 'versionId'), dto, principal);
  }

  @Post('versions/:versionId/try')
  @ApiOperation({ summary: 'Ejecutar la versión con entradas de ejemplo, sin persistir nada' })
  @ApiCreatedResponse({
    description: 'Resultado de la ejecución de prueba.',
    type: CalculatedFieldTryRunDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'PLATFORM_ADMIN')
  tryRun(
    @TenantId() tenantId: bigint,
    @Param('versionId') versionId: string,
    @Body() dto: TryCalculatedFieldDto,
  ) {
    return this.fields.tryRun(tenantId, parseBigIntId(versionId, 'versionId'), dto.inputs);
  }

  @Post('versions/:versionId/sample-inputs')
  @ApiOperation({
    summary: 'Generar entradas de ejemplo del contrato de la versión, sin ejecutarlas',
    description:
      'Deriva valores de las entradas declaradas (tipo y restricciones). Usa el mismo generador que el QA Lab, así que «válido», «frontera» e «inválido» significan lo mismo en las dos pantallas. La semilla devuelta reproduce el lote.',
  })
  @ApiCreatedResponse({
    description: 'Lote de entradas generadas, con la semilla que las reproduce.',
    type: VersionSampleInputsDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'PLATFORM_ADMIN')
  sampleInputs(
    @TenantId() tenantId: bigint,
    @Param('versionId') versionId: string,
    @Body() dto: SampleCalculatedFieldInputsDto,
  ) {
    return this.fields.sampleInputs(tenantId, parseBigIntId(versionId, 'versionId'), dto);
  }

  @Post('versions/:versionId/outcomes')
  @ApiOperation({
    summary: 'Qué desenlaces del contrato alcanza una versión guardada',
    description:
      'La misma cobertura que `preview/outcomes`, sobre una versión que ya existe. Comparte servicio a propósito: dos implementaciones acabarían dando dos respuestas distintas a la misma pregunta.',
  })
  @ApiCreatedResponse({
    description: 'Cobertura de desenlaces de la versión.',
    type: CalculatedFieldOutcomeCoverageReportDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'PLATFORM_ADMIN')
  async outcomes(
    @TenantId() tenantId: bigint,
    @Param('versionId') versionId: string,
    @Body() dto: CalculatedFieldOutcomeCoverageDto,
  ) {
    const executable = await this.fields.toExecutable(
      tenantId,
      parseBigIntId(versionId, 'versionId'),
    );
    return this.preview.coverageOf(executable, dto);
  }

  @Post('versions/:versionId/test')
  @ApiOperation({ summary: 'Ejecutar los casos de prueba declarados de la versión' })
  @ApiCreatedResponse({
    description: 'Informe de los casos de prueba declarados.',
    type: CalculatedFieldTestReportDto,
  })
  @Roles('RISK_ANALYST', 'FRAUD_ANALYST', 'QA_ANALYST', 'PLATFORM_ADMIN')
  test(@TenantId() tenantId: bigint, @Param('versionId') versionId: string) {
    return this.fields.runTestCases(tenantId, parseBigIntId(versionId, 'versionId'));
  }
}
