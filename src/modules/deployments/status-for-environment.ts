import { VersionStatus } from '@prisma/client';

/**
 * Traduce el código del ambiente al estado que queda escrito en la versión.
 *
 * `SANDBOX` era el nombre de `DEV` antes de que hubiera cuatro ambientes, y se
 * sigue aceptando porque una instalación puede tener esa fila en su catálogo:
 * caer al `default` la habría marcado como desplegada en TEST, que es mentira
 * y además una mentira invisible.
 */
export function statusForEnvironment(code: string): VersionStatus {
  switch (code.toUpperCase()) {
    case 'DEV':
    case 'DEVELOPMENT':
    case 'SANDBOX':
      return VersionStatus.DEPLOYED_TO_DEV;
    case 'STAGING':
      return VersionStatus.DEPLOYED_TO_STAGING;
    case 'TEST':
      return VersionStatus.DEPLOYED_TO_TEST;
    case 'PROD':
    case 'PRODUCTION':
      return VersionStatus.DEPLOYED_TO_PROD;
    default:
      return VersionStatus.DEPLOYED_TO_TEST;
  }
}
