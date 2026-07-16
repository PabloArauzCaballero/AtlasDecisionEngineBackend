import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../errors/domain-exception';

export function parseBigIntId(value: string, name = 'id'): bigint {
  if (!/^\d+$/.test(value)) {
    throw new DomainException('INVALID_ID', `${name} must be a positive integer`, HttpStatus.BAD_REQUEST);
  }
  return BigInt(value);
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
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new DomainException('INVALID_IF_MATCH', 'If-Match must be a positive integer');
  }
  return parsed;
}
