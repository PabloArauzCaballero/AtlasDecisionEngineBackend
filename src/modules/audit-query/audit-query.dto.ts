import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/http/pagination';

export class ExecutionSearchQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(100) artifactCode?: string;
  @IsOptional() @IsString() @MaxLength(80) outcome?: string;
  @IsOptional() @IsString() @MaxLength(160) requestId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class AuditEventSearchQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(120) eventType?: string;
  @IsOptional() @IsString() @MaxLength(120) aggregateType?: string;
  @IsOptional() @IsString() @MaxLength(160) actorId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
