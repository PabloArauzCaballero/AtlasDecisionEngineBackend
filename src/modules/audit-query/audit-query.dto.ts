import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { KeysetPaginationQueryDto, PaginationQueryDto } from '../../common/http/pagination';

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

/**
 * Same filters as {@link AuditEventSearchQueryDto}, paginated by cursor instead of offset.
 * `decision_audit_event` is append-only and the fastest-growing table in the platform, so a
 * deep offset scan there is the one that actually hurts; a cursor seek stays flat.
 */
export class AuditEventKeysetQueryDto extends KeysetPaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(120) eventType?: string;
  @IsOptional() @IsString() @MaxLength(120) aggregateType?: string;
  @IsOptional() @IsString() @MaxLength(160) actorId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
