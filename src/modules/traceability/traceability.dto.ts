/** Traceability contracts keep policy identifiers stable and linked database ids bounded. */
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../common/http/pagination';
import { DATABASE_ID_PATTERN } from '../../common/http/id';
import {
  IsArray,
  IsNotEmpty,
  IsObject,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class PolicyRequirementDto {
  @IsString() @Matches(/^[A-Z0-9_\-]{2,100}$/) policyCode!: string;
  @IsString() @IsNotEmpty() @MaxLength(8_000) rationale!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) owner!: string;
  @IsString() @MaxLength(30) severity!: string;
}

export class CreateBusinessObjectiveDto {
  @IsString() @Matches(/^[A-Z0-9_\-]{2,100}$/) objectiveCode!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) metric!: string;
  @IsObject() target!: Record<string, unknown>;
  @IsString() @IsNotEmpty() @MaxLength(100) ownerTeam!: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PolicyRequirementDto)
  policies!: PolicyRequirementDto[];
}

export class LinkPolicyArtifactDto {
  @IsString() @Matches(DATABASE_ID_PATTERN) artifactVersionId!: string;
}

export class LinkPolicyTestSuiteDto {
  @IsString() @Matches(DATABASE_ID_PATTERN) testSuiteId!: string;
}

export class ObjectiveListQueryDto extends PaginationQueryDto {}
