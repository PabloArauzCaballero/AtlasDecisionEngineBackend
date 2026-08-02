import { Type } from 'class-transformer';
import { DATABASE_ID_PATTERN } from '../../common/http/id';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Catalog fields exposed by vw_form_option for the portal create-form selects. */
export const FORM_OPTION_GROUPS = [
  'variableDataType',
  'dataClassification',
  'ownerTeam',
  'reasonSeverity',
  'reasonCategory',
  'artifactType',
  'riskDomain',
] as const;

export type FormOptionGroup = (typeof FORM_OPTION_GROUPS)[number];

export class ArtifactPickerQueryDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
}

export class ArtifactVersionPickerQueryDto {
  @IsOptional() @IsString() @MaxLength(100) artifactCode?: string;
  @IsOptional() @IsString() @MaxLength(40) status?: string;
}

export class VariablePickerQueryDto {
  @IsOptional() @IsString() @MaxLength(160) search?: string;
}

export class ArtifactInputContractQueryDto {
  @IsString() @IsNotEmpty() @MaxLength(100) artifactCode!: string;
}

/** Narrows suite options to the selected immutable artifact version. */
export class TestSuitePickerQueryDto {
  @IsOptional() @IsString() @Matches(DATABASE_ID_PATTERN) versionId?: string;
}

/** Narrows historical run options without converting database bigint IDs to JavaScript numbers. */
export class TestRunPickerQueryDto {
  @IsOptional() @IsString() @Matches(DATABASE_ID_PATTERN) versionId?: string;
}

/** Requires the artifact version whose reusable scripts the portal must display. */
export class NodeScriptListQueryDto {
  @IsString() @IsNotEmpty() @Matches(DATABASE_ID_PATTERN) versionId!: string;
}

export class GlobalSearchQueryDto {
  @IsString() @MinLength(2) @MaxLength(120) q!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

export class FormOptionQueryDto {
  @IsString() @IsIn([...FORM_OPTION_GROUPS]) group!: FormOptionGroup;
}
