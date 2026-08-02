/** Serializes and reads the refresh cookie with production-only Secure and safe expiry semantics. */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SessionCookieService {
  constructor(private readonly config: ConfigService) {}

  read(cookieHeader: string | undefined): string | undefined {
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

  serialize(refreshToken: string): string {
    const maxAge = this.config.get<number>('IDENTITY_REFRESH_COOKIE_MAX_AGE_SECONDS') ?? 2_592_000;
    return `${this.name()}=${encodeURIComponent(refreshToken)}; ${this.attributes()}; Max-Age=${maxAge}`;
  }

  clear(): string {
    return `${this.name()}=; ${this.attributes()}; Max-Age=0`;
  }

  private name(): string {
    return this.config.get<string>('IDENTITY_REFRESH_COOKIE_NAME') ?? 'atlas_refresh';
  }

  private attributes(): string {
    const secure = this.config.get<string>('NODE_ENV') === 'production' ? '; Secure' : '';
    return `Path=/v1/session; HttpOnly; SameSite=Strict${secure}`;
  }
}
