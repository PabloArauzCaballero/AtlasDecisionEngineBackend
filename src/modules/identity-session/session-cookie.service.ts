/** Serializes and reads the refresh cookie with production-only Secure and safe expiry semantics. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** What the refresh cookie carries once read: the provider's token and when the session began. */
export interface SessionCookie {
  refreshToken: string;
  /**
   * Epoch milliseconds of the sign-in that opened this session, or `null` when the cookie does not
   * prove it (an old-format cookie or a forged/altered envelope). `null` is NOT "unknown, carry on":
   * the absolute-lifetime check treats it as a session that must sign in again.
   */
  startedAt: number | null;
}

const ENVELOPE = 'v1';

/**
 * MOT-08 — the session's START travels inside the refresh cookie, signed and bound to the token.
 *
 * The identity provider's refresh token is opaque to this service and rotates on every refresh, so
 * nothing in it says when the person actually signed in. Without that instant the 12-hour absolute
 * limit could only live in the browser, where a reload resets it. The cookie value becomes
 * `v1.<startedAtMs>.<mac>.<refreshToken>`, where the MAC covers the version, the instant and the
 * token: moving the instant forward, or pasting an envelope from another session, fails the check.
 * The token goes last because it may itself contain dots (a JWT).
 *
 * The key is `IDENTITY_SESSION_SIGNING_SECRET` or, when unset, derived from `AUDIT_HASH_SECRET`
 * with a fixed label, so a deployment needs no new secret. Without either, signing fails closed.
 */
@Injectable()
export class SessionCookieService {
  constructor(private readonly config: ConfigService) {}

  /** The raw refresh token, whatever the cookie format. Logout needs it even from an old cookie. */
  read(cookieHeader: string | undefined): string | undefined {
    return this.readSession(cookieHeader)?.refreshToken;
  }

  readSession(cookieHeader: string | undefined): SessionCookie | undefined {
    const value = this.rawValue(cookieHeader);
    if (value === undefined) return undefined;
    const parts = value.split('.');
    if (parts.length < 4 || parts[0] !== ENVELOPE) return { refreshToken: value, startedAt: null };

    const [, started, mac] = parts;
    const refreshToken = parts.slice(3).join('.');
    const startedAt = /^\d{1,15}$/.test(started) ? Number(started) : Number.NaN;
    const valid = Number.isSafeInteger(startedAt) && this.verify(startedAt, refreshToken, mac);
    return { refreshToken, startedAt: valid ? startedAt : null };
  }

  serialize(refreshToken: string, startedAt: number): string {
    const maxAge = this.config.get<number>('IDENTITY_REFRESH_COOKIE_MAX_AGE_SECONDS') ?? 2_592_000;
    const started = Math.trunc(startedAt);
    const value = `${ENVELOPE}.${started}.${this.mac(started, refreshToken)}.${refreshToken}`;
    return `${this.name()}=${encodeURIComponent(value)}; ${this.attributes()}; Max-Age=${maxAge}`;
  }

  clear(): string {
    return `${this.name()}=; ${this.attributes()}; Max-Age=0`;
  }

  private rawValue(cookieHeader: string | undefined): string | undefined {
    if (!cookieHeader) return undefined;
    const cookieName = this.name();
    for (const part of cookieHeader.split(';')) {
      const separator = part.indexOf('=');
      if (separator < 0 || part.slice(0, separator).trim() !== cookieName) continue;
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private mac(startedAt: number, refreshToken: string): string {
    return createHmac('sha256', this.key())
      .update(`${ENVELOPE}.${startedAt}.${refreshToken}`)
      .digest('base64url');
  }

  private verify(startedAt: number, refreshToken: string, mac: string): boolean {
    let expected: Buffer;
    try {
      expected = Buffer.from(this.mac(startedAt, refreshToken));
    } catch {
      return false;
    }
    const received = Buffer.from(mac);
    return received.length === expected.length && timingSafeEqual(received, expected);
  }

  private key(): Buffer {
    const dedicated = this.config.get<string>('IDENTITY_SESSION_SIGNING_SECRET');
    if (dedicated) return Buffer.from(dedicated);
    const audit = this.config.get<string>('AUDIT_HASH_SECRET');
    if (!audit) throw new Error('No signing secret for the session cookie');
    // A derived key, not the audit secret itself: the same bytes never sign two kinds of thing.
    return createHmac('sha256', audit).update('atlas-session-cookie-v1').digest();
  }

  private name(): string {
    return this.config.get<string>('IDENTITY_REFRESH_COOKIE_NAME') ?? 'atlas_refresh';
  }

  private attributes(): string {
    const secure = this.config.get<string>('NODE_ENV') === 'production' ? '; Secure' : '';
    return `Path=/v1/session; HttpOnly; SameSite=Strict${secure}`;
  }
}
