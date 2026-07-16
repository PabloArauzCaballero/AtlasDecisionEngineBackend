import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalize } from './canonical-json';

@Injectable()
export class HashService {
  constructor(private readonly config: ConfigService) {}

  sha256(value: unknown): string {
    const data = typeof value === 'string' ? value : canonicalize(value);
    return createHash('sha256').update(data).digest('hex');
  }

  hmac(value: unknown): string {
    const secret = this.config.getOrThrow<string>('AUDIT_HASH_SECRET');
    const data = typeof value === 'string' ? value : canonicalize(value);
    return createHmac('sha256', secret).update(data).digest('hex');
  }

  equals(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
