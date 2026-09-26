/** Credentials/session commands are tightly bounded and tenant identifiers are positive decimals. */
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { DATABASE_ID_PATTERN } from '../../common/http/id';

export class IdentityLoginDto {
  @IsString()
  @Matches(DATABASE_ID_PATTERN)
  tenantId!: string;

  @IsEmail()
  @MaxLength(180)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

/**
 * Second login step. The bounds mirror the provider's own contract so a malformed attempt is
 * rejected here instead of spending a provider request — and, for the PIN, so a six-digit secret
 * cannot be probed with anything other than six digits.
 */
export class IdentityLoginPinDto {
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  challengeToken!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  pin!: string;
}

/**
 * Password change for the signed-in actor, in the same two steps as the login's second factor.
 *
 * Neither step carries an email or a user id on purpose: who changes the password is decided by
 * the bearer token, upstream. A body that named the account would make this a "change anyone's
 * password" endpoint for whoever holds any valid token.
 */
export class IdentityPasswordChangeRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;
}

export class IdentityPasswordChangeConfirmDto {
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  challengeToken!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;

  // Ten characters is the provider's own floor; rejecting a shorter one here saves a round trip
  // and keeps the two bounds from drifting apart silently.
  @IsString()
  @MinLength(10)
  @MaxLength(128)
  newPassword!: string;
}

export class IdentityLogoutDto {
  @IsOptional()
  @IsBoolean()
  allDevices = false;
}
