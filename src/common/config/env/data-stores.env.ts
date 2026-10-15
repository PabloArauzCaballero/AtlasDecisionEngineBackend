import { z } from 'zod';
import { booleanFromString, emptyAsUndefined, optionalUrl } from './helpers';

export const dataStoresEnv = {
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(15),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(250).max(60_000).default(5_000),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),

  // ---------------------------------------------------------------------
  // Separación de rutas de datos (ADR-0029).
  //
  // Vacías, las tres rutas son la misma conexión y el comportamiento es idéntico al
  // anterior: DATABASE_URL sigue siendo la única variable obligatoria. Declarar
  // DATABASE_READ_URL con el rol lector separa lectura y escritura por credencial;
  // apuntarla a otro host la separa por servidor (réplica). El registro reutiliza el
  // pool cuando las huellas coinciden, así que declarar la misma URL no duplica nada.
  // ---------------------------------------------------------------------
  DATABASE_WRITE_URL: z.string().optional().or(z.literal('')),
  DATABASE_READ_URL: z.string().optional().or(z.literal('')),
  /**
   * Pool de la ruta de lectura; sin valor hereda DATABASE_POOL_MAX.
   *
   * Con `emptyAsUndefined`, porque «sin valor» y «cadena vacía» son lo mismo para quien
   * configura: una plantilla con `DATABASE_READ_POOL_MAX=` y un secreto de CI que no se rellenó
   * producen exactamente eso. Sin el envoltorio, `z.coerce.number()` convierte `''` en 0 y la
   * aplicación NO ARRANCA con un «expected number to be >=1» que no menciona la variable que
   * quedó vacía — cuesta un rato averiguar que el problema es una línea sin valor.
   */
  DATABASE_READ_POOL_MAX: emptyAsUndefined(z.coerce.number().int().min(1).max(100).optional()),
  /**
   * Interruptor de la separación de rutas. Apagado, toda lectura vuelve al primario y el
   * sistema se comporta exactamente como antes: es el rollback de esta migración sin
   * desplegar nada. Se enciende cuando la conexión de lectura está aprovisionada.
   */
  DATA_READ_ROUTING_ENABLED: booleanFromString.default(false),
  /**
   * Ante una conexión de lectura no disponible, servir desde el primario. Nunca es
   * silencioso: cada degradación deja log estructurado y `atlas_database_fallback_total`.
   */
  ENABLE_PRIMARY_READ_FALLBACK: booleanFromString.default(true),
  /**
   * Reglas de enrutamiento por módulo, en JSON. Se fusionan sobre las reglas base de
   * `persistence/routing/routing-rules.ts`; un JSON inválido impide arrancar.
   * Ejemplo: {"views":{"read":"postgres-read","consistency":"eventual"}}
   */
  DATA_ROUTING_RULES: z.string().max(8_000).optional().or(z.literal('')),

  REDIS_URL: optionalUrl,
  REDIS_PREFIX: z
    .string()
    .regex(/^[a-zA-Z0-9:_-]{1,80}$/)
    .default('atlas:decision'),
  REQUIRE_REDIS_IN_PRODUCTION: booleanFromString.default(true),
};
