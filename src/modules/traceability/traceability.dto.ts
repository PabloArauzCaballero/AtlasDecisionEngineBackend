import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../common/http/pagination';
import { IsArray, IsNotEmpty, IsObject, IsString, Matches, ValidateNested } from 'class-validator';

export class PolicyRequirementDto {
  @IsString() @Matches(/^[A-Z0-9_\-]{2,100}$/) policyCode!: string;
  @IsString() @IsNotEmpty() rationale!: string;
  @IsString() @IsNotEmpty() owner!: string;
  @IsString() severity!: string;
}

export class CreateBusinessObjectiveDto {
  @IsString() @Matches(/^[A-Z0-9_\-]{2,100}$/) objectiveCode!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsNotEmpty() metric!: string;
  @IsObject() target!: Record<string, unknown>;
  @IsString() @IsNotEmpty() ownerTeam!: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PolicyRequirementDto)
  policies!: PolicyRequirementDto[];
}

export class LinkPolicyArtifactDto {
  @IsString() artifactVersionId!: string;
}

export class LinkPolicyTestSuiteDto {
  @IsString() testSuiteId!: string;
}

export class ObjectiveListQueryDto extends PaginationQueryDto {}
