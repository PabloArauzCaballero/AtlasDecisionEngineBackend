/** Bounded contracts for source analysis and optimistic-lock graph persistence. */
import { PaginationQueryDto } from '../../common/http/pagination';
import { DATABASE_ID_PATTERN } from '../../common/http/id';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class AnalyzeCodeImportDto {
  @IsIn(['JAVASCRIPT', 'PYTHON']) language!: 'JAVASCRIPT' | 'PYTHON';
  @IsString() @MaxLength(131_072) sourceCode!: string;
  @IsOptional() @IsString() @Matches(DATABASE_ID_PATTERN) artifactId?: string;
}

export class SaveCodeImportDto {
  @IsString() @Matches(DATABASE_ID_PATTERN) artifactVersionId!: string;
  @IsInt() @Min(1) expectedLockVersion!: number;
}

export class CodeImportListQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() @Matches(DATABASE_ID_PATTERN) artifactVersionId?: string;
}
