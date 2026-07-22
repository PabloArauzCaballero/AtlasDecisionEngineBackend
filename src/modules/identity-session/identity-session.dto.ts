import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class IdentityLoginDto {
  @IsString()
  @Matches(/^[1-9]\d*$/)
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
