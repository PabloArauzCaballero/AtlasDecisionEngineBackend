import { PaginationQueryDto } from '../../common/http/pagination';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class AnalyzeCodeImportDto {
  @IsIn(['JAVASCRIPT', 'PYTHON']) language!: 'JAVASCRIPT' | 'PYTHON';
  @IsString() @MaxLength(131_072) sourceCode!: string;
  @IsOptional() @IsString() artifactId?: string;
}

export class SaveCodeImportDto {
  @IsString() artifactVersionId!: string;
  @IsInt() @Min(1) expectedLockVersion!: number;
}

export class CodeImportListQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() @Matches(/^\d+$/) artifactVersionId?: string;
}
