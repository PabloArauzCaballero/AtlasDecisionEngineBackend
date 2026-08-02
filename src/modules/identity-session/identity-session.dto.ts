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

export class IdentityLogoutDto {
  @IsOptional()
  @IsBoolean()
  allDevices = false;
}
