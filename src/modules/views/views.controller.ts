/** Read-only portal API over bounded, tenant-scoped database projections. */
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { ApiArrayResponse } from '../../common/http/pagination.dto';
import { Roles, TenantId } from '../../common/security/security.decorators';
import {
  ArtifactInputContractQueryDto,
  ArtifactPickerQueryDto,
  ArtifactVersionPickerQueryDto,
  FormOptionQueryDto,
  GlobalSearchQueryDto,
  NodeScriptListQueryDto,
  TestRunPickerQueryDto,
  TestSuitePickerQueryDto,
  VariablePickerQueryDto,
} from './views.dto';
import {
  ArtifactInputContractDto,
  ArtifactPickerRowDto,
  ArtifactVersionPickerRowDto,
  FormOptionRowDto,
  GlobalSearchResultDto,
  NodeScriptRowDto,
  TestRunPickerRowDto,
  TestSuitePickerRowDto,
  VariablePickerRowDto,
} from './views.response.dto';
import { ViewsService } from './views.service';

const READ_ROLES = [
  'RISK_ANALYST',
  'FRAUD_ANALYST',
  'QA_ANALYST',
  'COMPLIANCE',
  'AUDITOR',
  'OPERATIONS',
] as const;

@ApiTags('Read Model Views')
@Controller('v1/views')
export class ViewsController {
  constructor(private readonly views: ViewsService) {}

  @Get('pickers/artifacts')
  @ApiOperation({ summary: 'List active artifacts for portal pickers' })
  @ApiArrayResponse(
    'Artefactos activos, acotados a 200 filas. Array desnudo, sin paginar.',
    ArtifactPickerRowDto,
  )
  @Roles(...READ_ROLES)
  artifacts(@TenantId() tenantId: bigint, @Query() query: ArtifactPickerQueryDto) {
    return this.views.artifactPicker(tenantId, query);
  }

  @Get('pickers/artifact-versions')
  @ApiOperation({ summary: 'List artifact versions for portal pickers' })
  @ApiArrayResponse(
    'Versiones de artefacto, acotadas a 200 filas. Array desnudo, sin paginar.',
    ArtifactVersionPickerRowDto,
  )
  @Roles(...READ_ROLES)
  artifactVersions(@TenantId() tenantId: bigint, @Query() query: ArtifactVersionPickerQueryDto) {
    return this.views.artifactVersionPicker(tenantId, query);
  }

  @Get('pickers/variables')
  @ApiOperation({ summary: 'List current variables for portal pickers' })
  @ApiArrayResponse(
    'Variables activas, acotadas a 200 filas. Array desnudo, sin paginar.',
    VariablePickerRowDto,
  )
  @Roles(...READ_ROLES)
  variables(@TenantId() tenantId: bigint, @Query() query: VariablePickerQueryDto) {
    return this.views.variablePicker(tenantId, query);
  }

  @Get('options')
  @ApiOperation({ summary: 'List authoritative catalog options for forms' })
  @ApiArrayResponse(
    'Valores distintos del catálogo para el grupo pedido. Array desnudo, sin paginar.',
    FormOptionRowDto,
  )
  @Roles(...READ_ROLES)
  options(@TenantId() tenantId: bigint, @Query() query: FormOptionQueryDto) {
    return this.views.formOptions(tenantId, query.group);
  }

  @Get('pickers/test-suites')
  @ApiOperation({ summary: 'List test suites for portal pickers' })
  @ApiArrayResponse(
    'Suites, acotadas a 200 filas. Array desnudo, sin paginar.',
    TestSuitePickerRowDto,
  )
  @Roles(...READ_ROLES)
  testSuites(@TenantId() tenantId: bigint, @Query() query: TestSuitePickerQueryDto) {
    return this.views.testSuitePicker(tenantId, query);
  }

  @Get('pickers/test-runs')
  @ApiOperation({ summary: 'List recent test runs for portal pickers' })
  @ApiArrayResponse(
    'Corridas recientes, acotadas a 200 filas. Array desnudo, sin paginar.',
    TestRunPickerRowDto,
  )
  @Roles(...READ_ROLES)
  testRuns(@TenantId() tenantId: bigint, @Query() query: TestRunPickerQueryDto) {
    return this.views.testRunPicker(tenantId, query);
  }

  @Get('artifact-inputs')
  @ApiOperation({ summary: 'Get the latest artifact input and validation contract' })
  @ApiOkResponse({
    description: 'Contrato de entrada de la última versión del artefacto.',
    type: ArtifactInputContractDto,
  })
  @Roles(...READ_ROLES)
  artifactInputs(@TenantId() tenantId: bigint, @Query() query: ArtifactInputContractQueryDto) {
    return this.views.artifactInputContract(tenantId, query);
  }

  @Get('scripts')
  @ApiOperation({ summary: 'List script nodes without exposing source in picker views' })
  @ApiArrayResponse('Metadatos de los scripts de la versión; nunca la fuente.', NodeScriptRowDto)
  @Roles(...READ_ROLES)
  scripts(@TenantId() tenantId: bigint, @Query() query: NodeScriptListQueryDto) {
    return this.views.nodeScripts(tenantId, parseBigIntId(query.versionId, 'versionId'));
  }

  @Get('search')
  @ApiOperation({ summary: 'Search governed entities across portal read models' })
  @ApiOkResponse({
    description: 'Resultados de búsqueda, acotados a `limit`.',
    type: GlobalSearchResultDto,
  })
  @Roles(...READ_ROLES)
  search(@TenantId() tenantId: bigint, @Query() query: GlobalSearchQueryDto) {
    return this.views.globalSearch(tenantId, query);
  }
}
