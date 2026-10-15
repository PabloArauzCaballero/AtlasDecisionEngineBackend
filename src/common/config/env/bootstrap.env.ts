import { z } from 'zod';
import { booleanFromString } from './helpers';

export const bootstrapEnv = {
  // Al arrancar, trae el conjunto sembrado que publica la rama `SEED_SOURCE_*` SI la base está
  // vacía; si ya tiene datos no toca nada, porque la carga es un reemplazo y no un upsert.
  // Sin declarar está activo en todas partes menos en `test`, donde las suites aportan sus
  // propios fixtures. Solo surte efecto donde corren los trabajos de fondo
  // (WORKER_ROLE ∈ ALL, WORKER): una réplica de API nunca siembra, aunque esto esté en `true`.
  STARTUP_SEED_ENABLED: booleanFromString.optional(),
  // El catálogo de REFERENCIA (padrón ASFI, logotipos, árbol de categorías): se siembra en cada arranque,
  // creando sólo lo que falte, independiente de STARTUP_SEED_ENABLED. `false` lo apaga (no debería hacer falta).
  REFERENCE_CATALOG_SEED_ENABLED: booleanFromString.optional(),
  // Bootstrap integration clients. Read straight from process.env by the seed helpers
  // (they stay framework-free so `prisma db seed` can run them without Nest); declared
  // here so the values are validated and documented instead of being magic strings.
  //
  // El tenant de TODO lo que siembra el módulo, no sólo de estos clientes: lo resuelve
  // `seeding/data/helpers.ts`. `[1-9][0-9]*` y no `[0-9]+` para que las dos validaciones
  // digan lo mismo — el `0` pasaba aquí y el resolutor lo rechaza, así que un despliegue
  // arrancaba y la siembra moría después, que es el peor sitio para enterarse.
  BOOTSTRAP_TENANT_ID: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .default('1'),
  // Sinónimo histórico, el que usan los guiones de `prisma/dev-seeds/`. Se declara para
  // que valide igual; si están las dos, manda BOOTSTRAP_TENANT_ID.
  SEED_TENANT_ID: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .optional(),
  BOOTSTRAP_MANAGEMENT_ROLES: z.string().default(''),
  // Gobierno: PLATFORM_ADMIN firma un paso sin tener su rol (QA, riesgo, cumplimiento). Apagado
  // por defecto (ISO 27002 5.3); sólo TEST/DEV lo encienden mientras nadie tiene esos roles.
  GOVERNANCE_ADMIN_CAN_SIGN_ANY_STEP: booleanFromString.default(false),
  BOOTSTRAP_RUNTIME_ROLES: z.string().default(''),
};
