import { ApiProperty } from '@nestjs/swagger';

/** `IdentitySessionController.logout`. */
export class LogoutResultDto {
  @ApiProperty({ example: true }) loggedOut!: boolean;
}
