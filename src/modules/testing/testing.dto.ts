import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../common/http/pagination';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

export class TestCaseDto {
  @IsString() @Matches(/^[A-Z0-9_\-]{2,100}$/) caseCode!: string;
  @IsString() @IsNotEmpty() testName!: string;
  @IsObject() input!: Record<string, unknown>;
  @IsObject() expectedResult!: Record<string, unknown>;
  @IsOptional() tags?: unknown;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateTestSuiteDto {
  @IsString() @Matches(/^[A-Z0-9_\-]{2,100}$/) suiteCode!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsString() suiteType!: string;
  @IsBoolean() isBlocking!: boolean;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => TestCaseDto)
  cases!: TestCaseDto[];
}

export class ImportTestCasesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => TestCaseDto)
  cases!: TestCaseDto[];
}

export class RunTestSuiteDto {
  @IsOptional() @IsString() @Matches(/^\d+$/) compiledArtifactId?: string;
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  baselineCompiledArtifactId?: string;
  @IsOptional() @IsString() triggerType?: string;
}

export class TestSuiteListQueryDto extends PaginationQueryDto {}
