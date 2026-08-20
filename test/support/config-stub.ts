/**
 * Configuración hermética para pruebas unitarias.
 *
 * `ConfigService` consulta `process.env` ANTES que el objeto que se le pasa al construirlo,
 * y `test/setup-env.ts` carga el `.env` del desarrollador en cada suite. Con eso, una
 * prueba que escriba `new ConfigService({ DATABASE_READ_URL: … })` no comprueba lo que dice
 * comprobar: comprueba lo que ese desarrollador tenga declarado en su máquina, y cambia de
 * resultado sin que cambie el código.
 *
 * Este doble lee **solo** el mapa que recibe. Es lo que permite fijar los escenarios A, B y
 * C de conexión sin depender del entorno.
 */
import type { ConfigService } from '@nestjs/config';

export function configStub(values: Record<string, unknown>): ConfigService {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`Missing configuration key "${key}"`);
      return value;
    },
  } as unknown as ConfigService;
}
