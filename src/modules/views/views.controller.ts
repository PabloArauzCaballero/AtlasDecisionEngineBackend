import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseBigIntId } from '../../common/http/id';
import { Roles, TenantId } from '../../common/security/security.decorators';
import {
  ArtifactInputContractQueryDto,
  ArtifactPickerQueryDto,
  ArtifactVersionPickerQueryDto,
  GlobalSearchQueryDto,
  NodeScriptListQueryDto,
  TestRunPickerQueryDto,
  TestSuitePickerQueryDto,
  VariablePickerQueryDto,
} from './views.dto';
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
  @Roles(...READ_ROLES)
  artifacts(@TenantId() tenantId: bigint, @Query() query: ArtifactPickerQueryDto) {
    return this.views.artifactPicker(tenantId, query);
  }

  @Get('pickers/artifact-versions')
  @Roles(...READ_ROLES)
  artifactVersions(@TenantId() tenantId: bigint, @Query() query: ArtifactVersionPickerQueryDto) {
    return this.views.artifactVersionPicker(tenantId, query);
  }

  @Get('pickers/variables')
  @Roles(...READ_ROLES)
  variables(@TenantId() tenantId: bigint, @Query() query: VariablePickerQueryDto) {
    return this.views.variablePicker(tenantId, query);
  }

  @Get('pickers/test-suites')
  @Roles(...READ_ROLES)
  testSuites(@TenantId() tenantId: bigint, @Query() query: TestSuitePickerQueryDto) {
    return this.views.testSuitePicker(tenantId, query);
  }

  @Get('pickers/test-runs')
  @Roles(...READ_ROLES)
  testRuns(@TenantId() tenantId: bigint, @Query() query: TestRunPickerQueryDto) {
    return this.views.testRunPicker(tenantId, query);
  }

  @Get('artifact-inputs')
  @Roles(...READ_ROLES)
  artifactInputs(@TenantId() tenantId: bigint, @Query() query: ArtifactInputContractQueryDto) {
    return this.views.artifactInputContract(tenantId, query);
  }

  @Get('scripts')
  @Roles(...READ_ROLES)
  scripts(@TenantId() tenantId: bigint, @Query() query: NodeScriptListQueryDto) {
    return this.views.nodeScripts(tenantId, parseBigIntId(query.versionId, 'versionId'));
  }

  @Get('search')
  @Roles(...READ_ROLES)
  search(@TenantId() tenantId: bigint, @Query() query: GlobalSearchQueryDto) {
    return this.views.globalSearch(tenantId, query);
  }
}
