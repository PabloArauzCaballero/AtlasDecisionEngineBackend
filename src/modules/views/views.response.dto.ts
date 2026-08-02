import { ApiProperty } from '@nestjs/swagger';

/** `vw_artifact_picker`. */
export class ArtifactPickerRowDto {
  @ApiProperty({ example: '4000' }) id!: string;
  @ApiProperty({ example: 'CREDIT_LIMIT_V2' }) artifactCode!: string;
  @ApiProperty({ example: 'Credit limit assignment' }) name!: string;
  @ApiProperty({ example: 'DECISION_TREE' }) artifactType!: string;
  @ApiProperty({ example: true }) isActive!: boolean;
  @ApiProperty({ example: 4, nullable: true }) latestVersionNumber!: number | null;
}

/** `vw_artifact_version_picker`. */
export class ArtifactVersionPickerRowDto {
  @ApiProperty({ example: '4001' }) id!: string;
  @ApiProperty({ example: 'CREDIT_LIMIT_V2' }) artifactCode!: string;
  @ApiProperty({ example: 'Credit limit assignment' }) artifactName!: string;
  @ApiProperty({ example: 3 }) versionNumber!: number;
  @ApiProperty({ example: '1.2.0' }) semanticVersion!: string;
  @ApiProperty({ example: 'DEPLOYED_TO_PROD' }) status!: string;
  @ApiProperty({ example: '2026-01-10T09:00:00.000Z' }) createdAt!: string;
}

/** `vw_variable_picker`. */
export class VariablePickerRowDto {
  @ApiProperty({ example: '3000' }) definitionId!: string;
  @ApiProperty({ example: 'applicant_income' }) variableCode!: string;
  @ApiProperty({ example: 'Applicant monthly income' }) canonicalName!: string;
  @ApiProperty({ example: false }) isSensitive!: boolean;
  @ApiProperty({ example: '3001' }) latestVersionId!: string;
  @ApiProperty({ example: 3 }) versionNumber!: number;
  @ApiProperty({ example: 'DECIMAL' }) dataType!: string;
  @ApiProperty({ example: false }) nullable!: boolean;
}

/** `vw_form_option`. */
export class FormOptionRowDto {
  @ApiProperty({ example: 'CREDIT_RISK' }) value!: string;
  @ApiProperty({ example: 'Credit risk' }) label!: string;
}

class ArtifactInputVariableRowDto {
  @ApiProperty({ example: '4001' }) versionId!: string;
  @ApiProperty({ example: 3 }) versionNumber!: number;
  @ApiProperty({ example: 'DEPLOYED_TO_PROD' }) versionStatus!: string;
  @ApiProperty({ example: 'INPUT' }) usageType!: string;
  @ApiProperty({ example: true }) isRequired!: boolean;
  @ApiProperty({ example: 'REJECT' }) fallbackPolicy!: string;
  @ApiProperty({ nullable: true }) dependencyPath!: string | null;
  @ApiProperty({ example: 'applicant_income' }) variableCode!: string;
  @ApiProperty({ example: 'Applicant monthly income' }) canonicalName!: string;
  @ApiProperty({ example: 'DECIMAL' }) dataType!: string;
  @ApiProperty({ example: false }) nullable!: boolean;
  @ApiProperty({ nullable: true }) defaultValue!: unknown;
  @ApiProperty({ nullable: true }) validationSchema!: unknown;
}

/** `ViewsService.artifactInputContract`: solo la última versión (`vw_artifact_input_contract`). */
export class ArtifactInputContractDto {
  @ApiProperty({ example: 'CREDIT_LIMIT_V2' }) artifactCode!: string;
  @ApiProperty({ nullable: true, example: '4001' }) versionId!: string | null;
  @ApiProperty({ nullable: true, example: 3 }) versionNumber!: number | null;
  @ApiProperty({ type: [ArtifactInputVariableRowDto] }) variables!: ArtifactInputVariableRowDto[];
}

/** `vw_test_suite_picker`. */
export class TestSuitePickerRowDto {
  @ApiProperty({ example: '7001' }) id!: string;
  @ApiProperty({ example: 'REGRESSION_V1' }) suiteCode!: string;
  @ApiProperty({ example: 'Regression suite v1' }) name!: string;
  @ApiProperty({ example: 'REGRESSION' }) suiteType!: string;
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
  @ApiProperty({ example: 'CREDIT_LIMIT_V2' }) artifactCode!: string;
  @ApiProperty({ example: 3 }) versionNumber!: number;
}

/** `vw_test_run_picker`. */
export class TestRunPickerRowDto {
  @ApiProperty({ example: '8501' }) id!: string;
  @ApiProperty({ example: 'SUCCEEDED' }) status!: string;
  @ApiProperty({ example: '2026-07-20T10:00:00.000Z' }) queuedAt!: string;
  @ApiProperty({ nullable: true }) finishedAt!: string | null;
  @ApiProperty({ example: 'REGRESSION_V1' }) suiteCode!: string;
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
  @ApiProperty({ example: 'CREDIT_LIMIT_V2' }) artifactCode!: string;
  @ApiProperty({ example: 3 }) versionNumber!: number;
}

/** `vw_node_script`: metadatos del script, nunca la fuente. */
export class NodeScriptRowDto {
  @ApiProperty({ example: '6501' }) id!: string;
  @ApiProperty({ example: '4001' }) artifactVersionId!: string;
  @ApiProperty({ example: 'CALC_DTI' }) nodeKey!: string;
  @ApiProperty({ example: 'JAVASCRIPT', enum: ['JAVASCRIPT', 'PYTHON'] }) language!: string;
  @ApiProperty({ example: 'a1b2c3...' }) sourceChecksum!: string;
  @ApiProperty({ example: '2026-07-20T10:00:00.000Z' }) updatedAt!: string;
  @ApiProperty({ example: 'CREDIT_LIMIT_V2' }) artifactCode!: string;
  @ApiProperty({ example: 3 }) versionNumber!: number;
}

class GlobalSearchRowDto {
  @ApiProperty({ example: 'ARTIFACT' }) entityType!: string;
  @ApiProperty({ example: '4000' }) entityId!: string;
  @ApiProperty({ example: 'CREDIT_LIMIT_V2' }) code!: string;
  @ApiProperty({ example: 'Credit limit assignment' }) title!: string;
  @ApiProperty({ nullable: true }) subtitle!: string | null;
  @ApiProperty({ nullable: true }) occurredAt!: string | null;
}

/** `ViewsService.globalSearch`: `vw_global_search`, acotado a `limit`. */
export class GlobalSearchResultDto {
  @ApiProperty({ example: 'credit limit' }) query!: string;
  @ApiProperty({ example: 12 }) total!: number;
  @ApiProperty({ type: [GlobalSearchRowDto] }) items!: GlobalSearchRowDto[];
}
