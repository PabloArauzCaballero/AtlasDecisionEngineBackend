import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { parseBigIntId } from '../../common/http/id';
import type {
  ArtifactInputContractQueryDto,
  ArtifactPickerQueryDto,
  ArtifactVersionPickerQueryDto,
  GlobalSearchQueryDto,
  TestRunPickerQueryDto,
  TestSuitePickerQueryDto,
  VariablePickerQueryDto,
} from './views.dto';

const PICKER_LIMIT = 200;

export interface GlobalSearchRow {
  entityType: string;
  entityId: bigint;
  code: string;
  title: string;
  subtitle: string | null;
  occurredAt: Date | null;
}

@Injectable()
export class ViewsService {
  constructor(private readonly prisma: PrismaService) {}

  artifactPicker(tenantId: bigint, query: ArtifactPickerQueryDto) {
    const filter = query.search
      ? Prisma.sql`AND (artifact_code ILIKE ${likePattern(query.search)} OR name ILIKE ${likePattern(query.search)})`
      : Prisma.empty;
    return this.prisma.$queryRaw(Prisma.sql`
      SELECT id, artifact_code AS "artifactCode", name, artifact_type AS "artifactType",
             is_active AS "isActive", latest_version_number AS "latestVersionNumber"
      FROM "vw_artifact_picker"
      WHERE tenant_id = ${tenantId} AND is_active ${filter}
      ORDER BY artifact_code ASC
      LIMIT ${PICKER_LIMIT}`);
  }

  artifactVersionPicker(tenantId: bigint, query: ArtifactVersionPickerQueryDto) {
    const byArtifact = query.artifactCode
      ? Prisma.sql`AND artifact_code = ${query.artifactCode}`
      : Prisma.empty;
    const byStatus = query.status ? Prisma.sql`AND status = ${query.status}` : Prisma.empty;
    return this.prisma.$queryRaw(Prisma.sql`
      SELECT id, artifact_code AS "artifactCode", artifact_name AS "artifactName",
             version_number AS "versionNumber", semantic_version AS "semanticVersion",
             status, created_at AS "createdAt"
      FROM "vw_artifact_version_picker"
      WHERE tenant_id = ${tenantId} ${byArtifact} ${byStatus}
      ORDER BY artifact_code ASC, version_number DESC
      LIMIT ${PICKER_LIMIT}`);
  }

  variablePicker(tenantId: bigint, query: VariablePickerQueryDto) {
    const filter = query.search
      ? Prisma.sql`AND (variable_code ILIKE ${likePattern(query.search)} OR canonical_name ILIKE ${likePattern(query.search)})`
      : Prisma.empty;
    return this.prisma.$queryRaw(Prisma.sql`
      SELECT definition_id AS "definitionId", variable_code AS "variableCode",
             canonical_name AS "canonicalName", is_sensitive AS "isSensitive",
             latest_version_id AS "latestVersionId", version_number AS "versionNumber",
             data_type AS "dataType", nullable
      FROM "vw_variable_picker"
      WHERE tenant_id = ${tenantId} AND is_active ${filter}
      ORDER BY variable_code ASC
      LIMIT ${PICKER_LIMIT}`);
  }

  /**
   * Distinct catalog values for a create-form select, from the idempotent
   * `vw_form_option` view. `group` is constrained by FormOptionQueryDto, so it is
   * safe to bind directly; the view is already tenant-scoped.
   */
  formOptions(tenantId: bigint, group: string) {
    return this.prisma.$queryRaw(Prisma.sql`
      SELECT DISTINCT value, label
      FROM "vw_form_option"
      WHERE tenant_id = ${tenantId} AND option_group = ${group}
      ORDER BY label ASC
      LIMIT ${PICKER_LIMIT}`);
  }

  async artifactInputContract(tenantId: bigint, query: ArtifactInputContractQueryDto) {
    const rows = await this.prisma.$queryRaw<
      Array<{ versionId: bigint; versionNumber: number; [key: string]: unknown }>
    >(Prisma.sql`
      SELECT version_id AS "versionId", version_number AS "versionNumber",
             version_status AS "versionStatus", usage_type AS "usageType",
             is_required AS "isRequired", fallback_policy AS "fallbackPolicy",
             dependency_path AS "dependencyPath", variable_code AS "variableCode",
             canonical_name AS "canonicalName", data_type AS "dataType", nullable,
             default_value_json AS "defaultValue",
             validation_schema_json AS "validationSchema"
      FROM "vw_artifact_input_contract"
      WHERE tenant_id = ${tenantId} AND artifact_code = ${query.artifactCode}
      ORDER BY version_number DESC, usage_type ASC, variable_code ASC`);
    const latest = rows[0]?.versionNumber;
    const variables = rows.filter((row) => row.versionNumber === latest);
    return {
      artifactCode: query.artifactCode,
      versionId: rows[0]?.versionId ?? null,
      versionNumber: latest ?? null,
      variables,
    };
  }

  testSuitePicker(tenantId: bigint, query: TestSuitePickerQueryDto) {
    const byVersion = query.versionId
      ? Prisma.sql`AND artifact_version_id = ${parseBigIntId(query.versionId, 'versionId')}`
      : Prisma.empty;
    return this.prisma.$queryRaw(Prisma.sql`
      SELECT id, suite_code AS "suiteCode", name, suite_type AS "suiteType",
             artifact_version_id AS "artifactVersionId", artifact_code AS "artifactCode",
             version_number AS "versionNumber"
      FROM "vw_test_suite_picker"
      WHERE tenant_id = ${tenantId} ${byVersion}
      ORDER BY artifact_code ASC, suite_code ASC
      LIMIT ${PICKER_LIMIT}`);
  }

  testRunPicker(tenantId: bigint, query: TestRunPickerQueryDto) {
    const byVersion = query.versionId
      ? Prisma.sql`AND artifact_version_id = ${parseBigIntId(query.versionId, 'versionId')}`
      : Prisma.empty;
    return this.prisma.$queryRaw(Prisma.sql`
      SELECT id, status, queued_at AS "queuedAt", finished_at AS "finishedAt",
             suite_code AS "suiteCode", artifact_version_id AS "artifactVersionId",
             artifact_code AS "artifactCode", version_number AS "versionNumber"
      FROM "vw_test_run_picker"
      WHERE tenant_id = ${tenantId} ${byVersion}
      ORDER BY queued_at DESC
      LIMIT ${PICKER_LIMIT}`);
  }

  nodeScripts(tenantId: bigint, versionId: bigint) {
    return this.prisma.$queryRaw(Prisma.sql`
      SELECT id, artifact_version_id AS "artifactVersionId", node_key AS "nodeKey",
             language, source_checksum AS "sourceChecksum", updated_at AS "updatedAt",
             artifact_code AS "artifactCode", version_number AS "versionNumber"
      FROM "vw_node_script"
      WHERE tenant_id = ${tenantId} AND artifact_version_id = ${versionId}
      ORDER BY node_key ASC`);
  }

  async globalSearch(tenantId: bigint, query: GlobalSearchQueryDto) {
    const limit = query.limit ?? 30;
    const pattern = likePattern(query.q);
    const items = await this.prisma.$queryRaw<GlobalSearchRow[]>(Prisma.sql`
      SELECT entity_type AS "entityType", entity_id AS "entityId", code, title,
             subtitle, occurred_at AS "occurredAt"
      FROM "vw_global_search"
      WHERE tenant_id = ${tenantId}
        AND (code ILIKE ${pattern} OR title ILIKE ${pattern} OR subtitle ILIKE ${pattern})
      ORDER BY (code ILIKE ${query.q}) DESC, occurred_at DESC NULLS LAST, code ASC
      LIMIT ${limit}`);
    return { query: query.q, total: items.length, items };
  }
}

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
