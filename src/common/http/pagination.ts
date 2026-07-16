import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize = 25;
}

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
}

export function paginationArgs(
  query: PaginationQueryDto,
  maxPageSize = 100,
): { skip: number; take: number; page: number; pageSize: number } {
  const page = Math.max(1, query.page || 1);
  const pageSize = Math.min(Math.max(1, query.pageSize || 25), maxPageSize);
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

export function pageResult<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PageResult<T> {
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  return {
    items,
    page,
    pageSize,
    total,
    totalPages,
    hasNextPage: page < totalPages,
  };
}
