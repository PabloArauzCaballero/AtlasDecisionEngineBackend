import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../errors/domain-exception';

/** Decimal shape shared by DTOs that ultimately address a PostgreSQL BIGINT primary key. */
export const DATABASE_ID_PATTERN = /^[1-9]\d{0,18}$/;
export const MAX_DATABASE_ID = 9_223_372_036_854_775_807n;

/**
 * Parses an external database id without letting malformed or out-of-range values
 * reach Prisma, where they would otherwise surface as an internal server error.
 */
export function parseBigIntId(value: string, name = 'id'): bigint {
  if (!DATABASE_ID_PATTERN.test(value)) {
    throw new DomainException(
      'INVALID_ID',
      `${name} must be a positive integer`,
      HttpStatus.BAD_REQUEST,
    );
  }
  const parsed = BigInt(value);
  if (parsed > MAX_DATABASE_ID) {
    throw new DomainException(
      'INVALID_ID',
      `${name} is outside the supported database range`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return parsed;
}

export function parseIfMatch(value: string | undefined): number {
  if (!value) {
    throw new DomainException(
      'IF_MATCH_REQUIRED',
      'If-Match header with current lock_version is required',
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
  const normalized = value.replace(/^W\//, '').replace(/"/g, '').trim();
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2_147_483_647) {
    throw new DomainException('INVALID_IF_MATCH', 'If-Match must be a positive integer');
  }
  return parsed;
}
