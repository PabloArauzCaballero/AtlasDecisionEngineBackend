import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
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

export class TestSuitePickerQueryDto {
  @IsOptional() @IsString() @MaxLength(30) versionId?: string;
}

export class TestRunPickerQueryDto {
  @IsOptional() @IsString() @MaxLength(30) versionId?: string;
}

export class NodeScriptListQueryDto {
  @IsString() @IsNotEmpty() @MaxLength(30) versionId!: string;
}

export class GlobalSearchQueryDto {
  @IsString() @MinLength(2) @MaxLength(120) q!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

export class FormOptionQueryDto {
  @IsString() @IsIn([...FORM_OPTION_GROUPS]) group!: FormOptionGroup;
}
