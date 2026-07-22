import { HttpStatus } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DomainException } from '../errors/domain-exception';

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

/**
 * Keyset (cursor) pagination over a monotonic bigint `id`, newest-first.
 *
 * Offset pagination (`skip/take`) is O(n) at deep offsets: page 10_000 of
 * `decision_execution` makes Postgres walk and discard every prior row. Keyset seeks
 * straight to the cursor via the primary-key index, so cost is independent of depth — the
 * right tool for the highest-growth tables. It trades away random page access and a total
 * count, which those append-only logs do not need.
 */
export class KeysetPaginationQueryDto {
  /** Opaque cursor from a previous page's `nextCursor`. Absent on the first page. */
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize = 25;
}

export interface KeysetPage<T> {
  items: T[];
  pageSize: number;
  /** Cursor to pass as `cursor` for the following page, or null when the list is exhausted. */
  nextCursor: string | null;
  hasNextPage: boolean;
}

/** Encodes a bigint sort key as an opaque, URL-safe cursor. */
export function encodeCursor(id: bigint): string {
  return Buffer.from(id.toString(), 'utf8').toString('base64url');
}

/** Decodes an opaque cursor back to its bigint sort key, rejecting malformed input. */
export function decodeCursor(cursor: string): bigint {
  try {
    const value = BigInt(Buffer.from(cursor, 'base64url').toString('utf8').trim());
    if (value < 0n) throw new Error('negative cursor');
    return value;
  } catch {
    throw new DomainException(
      'INVALID_CURSOR',
      'The pagination cursor is malformed',
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * Builds a Prisma query fragment for a keyset seek over a descending bigint `id`.
 *
 * `take` is `pageSize + 1`: fetching one extra row is how {@link keysetPage} detects
 * whether a further page exists without a separate count query.
 */
export function keysetArgs(
  query: KeysetPaginationQueryDto,
  maxPageSize = 100,
): { take: number; pageSize: number; orderBy: { id: 'desc' }; where?: { id: { lt: bigint } } } {
  const pageSize = Math.min(Math.max(1, query.pageSize || 25), maxPageSize);
  const args: {
    take: number;
    pageSize: number;
    orderBy: { id: 'desc' };
    where?: { id: { lt: bigint } };
  } = {
    take: pageSize + 1,
    pageSize,
    orderBy: { id: 'desc' },
  };
  if (query.cursor) args.where = { id: { lt: decodeCursor(query.cursor) } };
  return args;
}

/**
 * Assembles a keyset page from rows fetched with {@link keysetArgs} (i.e. `pageSize + 1`
 * of them). Trims the sentinel row and derives the next cursor from the last kept row.
 */
export function keysetPage<T extends { id: bigint }>(rows: T[], pageSize: number): KeysetPage<T> {
  const hasNextPage = rows.length > pageSize;
  const items = hasNextPage ? rows.slice(0, pageSize) : rows;
  const nextCursor = hasNextPage && items.length ? encodeCursor(items[items.length - 1].id) : null;
  return { items, pageSize, nextCursor, hasNextPage };
}
