import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../errors/domain-exception';
import { identityProviderSessionSchema, type IdentitySession } from './identity-provider.contract';

/**
 * Cookie names issued by the identity provider's internal auth endpoints. They are the only
 * place login and refresh return tokens; the response body never carries them.
 */
const ACCESS_TOKEN_COOKIE = 'atlas_internal_access';
const REFRESH_TOKEN_COOKIE = 'atlas_internal_refresh';

/**
 * A provider reply that does not match the contract is a 502, never a 401.
 *
 * Reporting it as "invalid credentials" is how a provider-side contract drift turns into a
 * support queue full of operators certain their password works — because it does.
 */
export function parseOrBadGateway<T>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  payload: unknown,
  what: string,
): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success || parsed.data === undefined) {
    throw new DomainException(
      'IDENTITY_PROVIDER_INVALID_RESPONSE',
      `Identity provider did not return ${what} matching the expected contract`,
      HttpStatus.BAD_GATEWAY,
    );
  }
  return parsed.data;
}

export function toSession(payload: unknown, response: Response): IdentitySession {
  const parsed = identityProviderSessionSchema.safeParse(payload);
  // Only a rejected credential is an authentication failure. A session that cannot be read
  // is a contract problem, and reporting it as "invalid credentials" is what previously hid
  // this drift behind a login screen that simply refused every correct password.
  if (!parsed.success) {
    throw new DomainException(
      'IDENTITY_PROVIDER_INVALID_RESPONSE',
      'Identity provider returned a session that does not match the expected contract',
      HttpStatus.BAD_GATEWAY,
    );
  }
  if (parsed.data.user.status.toUpperCase() !== 'ACTIVE') throw unauthorized();

  const cookies = setCookies(response);
  const accessToken = parsed.data.accessToken ?? cookies[ACCESS_TOKEN_COOKIE];
  const refreshToken = parsed.data.refreshToken ?? cookies[REFRESH_TOKEN_COOKIE];
  if (!accessToken || !refreshToken) {
    throw new DomainException(
      'IDENTITY_PROVIDER_INVALID_RESPONSE',
      'Identity provider did not return session tokens',
      HttpStatus.BAD_GATEWAY,
    );
  }

  return {
    user: parsed.data.user,
    expiresIn: parsed.data.expiresIn,
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
  };
}

/** Parses Set-Cookie into {name: value}; the provider sends one cookie per header. */
function setCookies(response: Response): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const separator = pair?.indexOf('=') ?? -1;
    if (!pair || separator === -1) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!name || !value) continue;
    try {
      entries[name] = decodeURIComponent(value);
    } catch {
      entries[name] = value;
    }
  }
  return entries;
}

export function unauthorized(): DomainException {
  return new DomainException('UNAUTHORIZED', 'Invalid or expired session', HttpStatus.UNAUTHORIZED);
}
