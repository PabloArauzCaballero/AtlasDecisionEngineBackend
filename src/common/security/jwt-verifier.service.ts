import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import { DomainException } from '../errors/domain-exception';
import type { ApiAudience } from './security.types';

interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface JwtClaims extends Record<string, unknown> {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
}

interface Jwk extends Record<string, unknown> {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
}

interface JwksDocument {
  keys?: Jwk[];
}

export interface VerifiedJwtPrincipal {
  subject: string;
  tenantId: bigint;
  roles: string[];
  tokenId?: string;
}

@Injectable()
export class JwtVerifierService {
  private cachedKeys = new Map<string, Jwk>();
  private cacheExpiresAt = 0;

  constructor(private readonly config: ConfigService) {}

  async verify(token: string, audience: ApiAudience): Promise<VerifiedJwtPrincipal> {
    try {
      const [encodedHeader, encodedPayload, encodedSignature, ...rest] = token.split('.');
      if (!encodedHeader || !encodedPayload || !encodedSignature || rest.length) {
        throw new Error('Malformed token');
      }
      const header = this.decodeJson<JwtHeader>(encodedHeader);
      const claims = this.decodeJson<JwtClaims>(encodedPayload);
      if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported signing algorithm');

      const key = await this.getKey(header.kid);
      const publicKey = createPublicKey({ key: key as unknown as JsonWebKey, format: 'jwk' });
      const signatureValid = verify(
        'RSA-SHA256',
        Buffer.from(`${encodedHeader}.${encodedPayload}`),
        publicKey,
        Buffer.from(encodedSignature, 'base64url'),
      );
      if (!signatureValid) throw new Error('Invalid signature');

      this.validateClaims(claims, audience);
      const tenantClaim = this.readClaim(claims, this.config.get<string>('JWT_TENANT_CLAIM') ?? 'tenant_id');
      const rolesClaim = this.readClaim(claims, this.config.get<string>('JWT_ROLES_CLAIM') ?? 'roles');
      const tenantId = this.parseTenantId(tenantClaim);
      const roles = this.parseRoles(rolesClaim);
      if (!claims.sub) throw new Error('Missing subject');
      return { subject: claims.sub, tenantId, roles, tokenId: claims.jti };
    } catch {
      throw new DomainException('UNAUTHORIZED', 'Invalid or expired bearer token', HttpStatus.UNAUTHORIZED);
    }
  }

  private validateClaims(claims: JwtClaims, audience: ApiAudience): void {
    const issuer = this.config.get<string>('JWT_ISSUER') ?? '';
    const expectedAudience = this.config.get<string>(
      audience === 'runtime' ? 'JWT_RUNTIME_AUDIENCE' : 'JWT_MANAGEMENT_AUDIENCE',
    );
    const now = Math.floor(Date.now() / 1_000);
    const skew = this.config.get<number>('JWT_CLOCK_SKEW_SECONDS') ?? 30;
    if (!issuer || claims.iss !== issuer) throw new Error('Invalid issuer');
    const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
    if (!expectedAudience || !audiences.includes(expectedAudience)) throw new Error('Invalid audience');
    if (typeof claims.exp !== 'number' || claims.exp + skew < now) throw new Error('Expired token');
    if (typeof claims.nbf === 'number' && claims.nbf - skew > now) throw new Error('Token not active');
    if (typeof claims.iat === 'number' && claims.iat - skew > now) throw new Error('Issued in the future');
  }

  private async getKey(kid: string): Promise<Jwk> {
    if (Date.now() >= this.cacheExpiresAt || !this.cachedKeys.has(kid)) await this.refreshKeys();
    const key = this.cachedKeys.get(kid);
    if (!key) {
      await this.refreshKeys(true);
      const refreshed = this.cachedKeys.get(kid);
      if (!refreshed) throw new Error('Signing key not found');
      return refreshed;
    }
    return key;
  }

  private async refreshKeys(force = false): Promise<void> {
    if (!force && Date.now() < this.cacheExpiresAt && this.cachedKeys.size) return;
    const url = this.config.get<string>('JWT_JWKS_URL');
    if (!url) throw new Error('JWKS URL not configured');
    const timeoutMs = this.config.get<number>('JWT_JWKS_TIMEOUT_MS') ?? 3_000;
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`JWKS request failed with ${response.status}`);
    const document = (await response.json()) as JwksDocument;
    // Only accept RSA signing keys: a key published for encryption (use='enc') or advertising
    // a different algorithm must never be selected to verify an RS256 signature.
    const keys = (document.keys ?? []).filter(
      (key) =>
        key.kid &&
        key.kty === 'RSA' &&
        (key.use === undefined || key.use === 'sig') &&
        (key.alg === undefined || key.alg === 'RS256'),
    );
    if (!keys.length) throw new Error('No usable RSA signing keys in JWKS');
    this.cachedKeys = new Map(keys.map((key) => [key.kid as string, key]));
    const cacheSeconds = this.config.get<number>('JWT_JWKS_CACHE_SECONDS') ?? 900;
    this.cacheExpiresAt = Date.now() + cacheSeconds * 1_000;
  }

  private decodeJson<T>(value: string): T {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
  }

  private readClaim(claims: JwtClaims, path: string): unknown {
    return path.split('.').reduce<unknown>((value, segment) => {
      if (!value || typeof value !== 'object') return undefined;
      return (value as Record<string, unknown>)[segment];
    }, claims);
  }

  private parseTenantId(value: unknown): bigint {
    const normalized = typeof value === 'number' ? String(value) : value;
    if (typeof normalized !== 'string' || !/^[1-9]\d*$/.test(normalized)) {
      throw new Error('Invalid tenant claim');
    }
    return BigInt(normalized);
  }

  private parseRoles(value: unknown): string[] {
    const raw = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(/[\s,]+/)
        : [];
    return [...new Set(raw.filter((role): role is string => typeof role === 'string')
      .map((role) => role.trim().toUpperCase())
      .filter(Boolean))];
  }
}
