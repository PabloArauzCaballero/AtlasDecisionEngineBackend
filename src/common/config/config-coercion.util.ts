import type { ConfigService } from '@nestjs/config';

/**
 * Lectura de ajustes numéricos y booleanos sin fiarse del tipo que devuelve `ConfigService`.
 *
 * `config.get<number>(...)` NO convierte nada: el genérico es un cast de TypeScript sobre un valor
 * que, cuando sale de `process.env`, es una cadena. Con el esquema de entorno activo llega coercido
 * (`z.coerce.number()`) y todo funciona; en cuanto se lee el valor crudo —un `ConfigService`
 * construido a mano, un ajuste que el esquema no cubra— las cadenas se cuelan y rompen cosas que no
 * se parecen en nada a un problema de configuración:
 *
 * - `AbortSignal.timeout('12000')` lanza `TypeError`. Ocurría dentro del `try` del `fetch` del
 *   cliente de identidad, que lo leía como «el proveedor no contesta» y devolvía 503: el login
 *   entero fallaba culpando a un proveedor sano.
 * - `'2' + 1` es `'21'`: el contador de reintentos se convertía en veintiún intentos.
 * - `take: '500'` hace que Prisma rechace la consulta entera («Expected Int, provided String»).
 * - `'false'` es verdadero en JavaScript, así que apagar un interruptor por variable de entorno lo
 *   dejaba encendido.
 *
 * Por eso la conversión vive aquí y no repetida en cada punto de lectura.
 */
export function numeroDeConfig(config: ConfigService, clave: string, porDefecto: number): number {
  const crudo: unknown = config.get(clave);
  if (crudo === undefined || crudo === null || crudo === '') return porDefecto;
  const numero = Number(crudo);
  // Un ajuste ilegible cae al valor por defecto: es preferible a propagar un NaN que reaparecerá
  // más tarde como un timeout inválido o un `take` sin sentido.
  return Number.isFinite(numero) ? numero : porDefecto;
}

/**
 * Booleano de configuración. Sólo la cadena `'false'` (en cualquier caja) apaga: cualquier otro
 * valor presente enciende, y la ausencia cae al valor por defecto.
 */
export function booleanoDeConfig(
  config: ConfigService,
  clave: string,
  porDefecto: boolean,
): boolean {
  const crudo: unknown = config.get(clave);
  if (crudo === undefined || crudo === null || crudo === '') return porDefecto;
  if (typeof crudo === 'boolean') return crudo;
  return String(crudo).trim().toLowerCase() !== 'false';
}
