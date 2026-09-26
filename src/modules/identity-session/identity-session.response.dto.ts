import { ApiProperty } from '@nestjs/swagger';

/**
 * El desafío de segundo factor que devuelve una petición de cambio de contraseña.
 *
 * Es la MISMA forma que el desafío del login, y a propósito: el portal reutiliza
 * una sola pantalla de PIN para los dos en vez de aprender un segundo contrato
 * para lo mismo. Se declara aquí porque el contrato de salida del motor tiene que
 * poder leerse sin el código del proveedor de identidad delante.
 */
export class IdentityPinChallengeDto {
  @ApiProperty({ example: true }) pinChallengeRequired!: boolean;
  @ApiProperty({ description: 'Se canjea junto al código recibido por correo.' })
  challengeToken!: string;
  @ApiProperty({ example: 10 }) expiresInMinutes!: number;
}

/** `IdentitySessionController.confirmPasswordChange`. */
export class IdentityPasswordChangedDto {
  @ApiProperty({ example: true }) passwordChanged!: boolean;
}

/** `IdentitySessionController.logout`. */
export class LogoutResultDto {
  @ApiProperty({ example: true }) loggedOut!: boolean;
}
