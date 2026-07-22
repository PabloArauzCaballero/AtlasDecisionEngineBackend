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
    return this.hmacWithKey(value, this.activeHashKeyId());
  }

  /** The key id that hmac() currently signs with; persisted alongside each audit event. */
  activeHashKeyId(): string {
    return this.config.get<string>('AUDIT_HASH_KEY_ID') ?? 'v1';
  }

  /**
   * Signs with a specific key id so a rotated secret does not invalidate the historical
   * audit chain: verification re-signs each event with the key that produced it.
   *
   * @throws Error when the key id is unknown — a chain must never silently verify as
   * valid because a retired secret could not be found.
   */
  hmacWithKey(value: unknown, keyId: string): string {
    const secret = this.secretForKey(keyId);
    const data = typeof value === 'string' ? value : canonicalize(value);
    return createHmac('sha256', secret).update(data).digest('hex');
  }

  private secretForKey(keyId: string): string {
    if (keyId === this.activeHashKeyId())
      return this.config.getOrThrow<string>('AUDIT_HASH_SECRET');
    const retired = this.retiredSecrets()[keyId];
    if (!retired) throw new Error(`No audit hash secret configured for key id "${keyId}"`);
    return retired;
  }

  /** Retired signing secrets, kept only to verify events written before a rotation. */
  private retiredSecrets(): Record<string, string> {
    const raw = this.config.get<string>('AUDIT_HASH_PREVIOUS_SECRETS');
    if (!raw) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
    } catch {
      throw new Error('AUDIT_HASH_PREVIOUS_SECRETS must be a JSON object of {keyId: secret}');
    }
  }

  equals(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
