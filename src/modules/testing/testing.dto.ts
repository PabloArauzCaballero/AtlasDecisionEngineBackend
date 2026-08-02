/** Test contracts bound suite/case fan-out and keep expected results explicit and serializable. */
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../common/http/pagination';
import { DATABASE_ID_PATTERN } from '../../common/http/id';
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
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class TestCaseDto {
  @IsString() @Matches(/^[A-Z0-9_\-]{2,100}$/) caseCode!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) testName!: string;
  @IsObject() input!: Record<string, unknown>;
  @IsObject() expectedResult!: Record<string, unknown>;
  @IsOptional() tags?: unknown;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateTestSuiteDto {
  @IsString() @Matches(/^[A-Z0-9_\-]{2,100}$/) suiteCode!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @IsString() @MaxLength(50) suiteType!: string;
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
  @IsOptional() @IsString() @Matches(DATABASE_ID_PATTERN) compiledArtifactId?: string;
  /** Reserved contract: the service rejects it until comparative assertions are persisted. */
  @IsOptional()
  @IsString()
  @Matches(DATABASE_ID_PATTERN)
  baselineCompiledArtifactId?: string;
  @IsOptional() @IsString() @MaxLength(50) triggerType?: string;
}

export class TestSuiteListQueryDto extends PaginationQueryDto {}
