// Jest does not load .env by itself. Until now only specs that happened to import
// PrismaClient saw DATABASE_URL, because Prisma loads .env as an import side effect. Specs
// that talk to Postgres through `pg` directly — the tenant RLS isolation/views guards and
// the deployment invariants — therefore read an undefined DATABASE_URL and silently
// self-skipped, so a full `npm test` reported green while the RLS security guards had never
// executed. Loading the env here makes the DATABASE_URL gate mean the same thing for every
// spec, whichever driver it imports.
import { config } from 'dotenv';

config();

/*
 * Y aquí termina la tolerancia: en CI, sin base de datos NO se corre.
 *
 * Cargar el `.env` arregló que el salto significara lo mismo para todas las suites, pero no
 * arregló lo esencial: `const describeDb = DATABASE_URL ? describe : describe.skip` deja una
 * corrida EN VERDE cuando la variable falta. Y las suites que dependen de ella no son
 * cualquiera — son las que sostienen las afirmaciones regulatorias del sistema:
 *
 *   tenant-rls-isolation · rls-guc-contamination · audit-append-only · audit-transactional
 *   governance-sod · postgres-role-privileges · idempotency-lease · deployment-invariants
 *
 * Una corrida verde sin ellas no dice «el aislamiento entre inquilinos funciona»; dice «no se
 * midió». Y las dos cosas se leen igual en el informe, que es exactamente el modo de fallo que
 * esta batería existe para no tener.
 *
 * Se falla en el ARRANQUE y no dentro de una prueba: así el mensaje señala la configuración que
 * falta en vez de aparecer como una aserción rota en un fichero que no tiene la culpa.
 *
 * Fuera de CI el salto sigue siendo válido: alguien que corre una suite de lógica pura en su
 * portátil no necesita Postgres levantado, y obligarle a ello convierte la batería en algo que
 * no se corre. `REQUIRE_DB_SUITES=true` permite exigirlo también en local.
 */
const EXIGE_BASE = process.env.CI === 'true' || process.env.REQUIRE_DB_SUITES === 'true';

if (EXIGE_BASE && !process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL no está definida y esta corrida la exige (CI=true o REQUIRE_DB_SUITES=true).\n' +
      'Sin ella, las suites de aislamiento por inquilino, cadena de auditoría y separación de ' +
      'funciones se saltan EN SILENCIO y la corrida sale verde sin haberlas ejecutado.\n' +
      'Levanta la base (`docker compose up -d postgres`) y aplica las migraciones ' +
      '(`yarn prisma:migrate`), o quita CI/REQUIRE_DB_SUITES si de verdad quieres saltarlas.',
  );
}
