import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { KeysetPaginationQueryDto } from '../../common/http/pagination';

/**
 * Inbox listing query. Keyset-paginated from day one (the audit-feed pattern): an inbox
 * is an append-only, ever-growing log, exactly the shape where offset paging degrades.
 */
export class NotificationListQueryDto extends KeysetPaginationQueryDto {
  /** Kept as string literals: query params arrive as strings and implicit conversion is off. */
  @IsOptional() @IsIn(['true', 'false']) unreadOnly?: 'true' | 'false';
  @IsOptional() @IsString() @MaxLength(50) category?: string;
}
