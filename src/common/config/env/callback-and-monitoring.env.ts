import { z } from 'zod';
import { booleanFromString, emptyAsUndefined, boundedInt } from './helpers';

export const callbackAndMonitoringEnv = {
  /*
   * --- Aviso de vuelta a AtlasBackend (src/modules/atlas-callback) ----------------------
   *
   * Cuando una persona resuelve en el motor una revisión manual (identidad, riesgo, crédito)
   * o la de un extracto, el motor se lo dice a AtlasBackend con un POST que sale del OUTBOX.
   * Las dos variables se leían sin declarar, y sin ellas el aviso se daba por ENTREGADO: el
   * evento se consumía, el caso quedaba resuelto aquí y el cliente seguía «en revisión» en
   * AtlasBackend para siempre. Ahora, fuera de `ATLAS_CALLBACK_DISABLED=true`, el aviso sin
   * configuración NO se consume: se reintenta y, agotados los intentos, queda en `DEAD`
   * (alerta `AtlasOutboxDeadLetter`) para reprocesarlo cuando la configuración exista. En
   * producción el arranque exige las dos juntas (ver el `superRefine`).
   */
  // Base de AtlasBackend a la que el motor devuelve cada resolución humana (p. ej. `http://atlas-backend:3005/api/v1`). La leen el worker y cualquier proceso con WORKER_ROLE=ALL, que son quienes reparten el outbox. En producción es obligatoria junto con ENGINE_CALLBACK_API_KEY salvo ATLAS_CALLBACK_DISABLED=true.
  ATLAS_BACKEND_BASE_URL: emptyAsUndefined(z.string().url().optional()),
  // Clave que el motor envía en `x-engine-callback-key` y que AtlasBackend valida. Secreto: va en el gestor de secretos, nunca en un ConfigMap. En producción es obligatoria junto con ATLAS_BACKEND_BASE_URL salvo ATLAS_CALLBACK_DISABLED=true.
  ENGINE_CALLBACK_API_KEY: emptyAsUndefined(z.string().min(1).optional()),
  // `true` declara que este despliegue opera SIN AtlasBackend a propósito: las resoluciones humanas no se avisan a nadie y el aviso se consume con un registro de advertencia. Sin esta declaración, un aviso sin configuración no se pierde: se reintenta y acaba en DEAD, visible y reprocesable.
  ATLAS_CALLBACK_DISABLED: booleanFromString.default(false),

  // --- Vigilancia continua de modelos (src/modules/model-monitoring) ---------------------
  // Enciende el trabajo `monitoring-evaluation`, que mide las versiones desplegadas en producción y publica el aviso de degradación. Sólo tiene efecto donde corren los trabajos de fondo (WORKER_ROLE ∈ ALL, WORKER).
  MONITORING_EVALUATION_ENABLED: booleanFromString.default(true),
  // Cada cuánto se evalúan las versiones vivas. Seis horas por omisión; más de 48 h sin medir es un BREACH por derecho propio (MONITORING_FRESHNESS_HOURS).
  MONITORING_EVALUATION_INTERVAL_MS: boundedInt(60_000, 604_800_000).default(21_600_000),
  // Ventanas de observación del desenlace, en días y separadas por comas (sin valor, `30,60,90,180,360`). Se programan al decidir, sólo para CREDIT_ORIGINATION y con sujeto. Una entrada ilegible se descarta en vez de impedir el arranque, a propósito: ver `parseWindowDays` en src/modules/runtime/outcome-windows.ts.
  OUTCOME_WINDOW_DAYS: emptyAsUndefined(z.string().optional()),

  // --- Consola SQL de solo lectura (src/modules/sql-console) ----------------------------
  // Techo de filas que devuelve una consulta de la consola; lo que pasa de ahí se trunca y se dice.
  SQL_CONSOLE_MAX_ROWS: z.coerce.number().int().min(1).max(100_000).default(10_000),
  // Plazo de una consulta de la consola (statement_timeout), en milisegundos.
  SQL_CONSOLE_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(12_000),
};
