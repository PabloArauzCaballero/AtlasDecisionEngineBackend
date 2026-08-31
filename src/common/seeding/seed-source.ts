/**
 * Los datos de semilla ya no viven en el repositorio: viven en una RAMA de PostgreSQL gestionado
 * (Neon), y este módulo dice cuál.
 *
 * La rama es la unidad de configuración a propósito. Un despliegue no elige "perfil de seeds"
 * compilado en el código, elige una rama: la de desarrollo trae también los usuarios y comercios de
 * prueba, la de producción sólo el dato maestro. Cambiar de una a otra es cambiar UNA variable, y
 * como cada rama de Neon tiene su propio endpoint, `SEED_SOURCE_HOST` es literalmente el nombre de
 * la rama a la que se apunta.
 *
 * Dos formas de declararla, en este orden:
 *
 *   1. `SEED_SOURCE_DATABASE_URL` — cadena completa. Gana sobre todo lo demás. Es la vía para CI y
 *      para un secreto inyectado de una pieza.
 *   2. `SEED_SOURCE_HOST` + `SEED_SOURCE_DB` + `SEED_SOURCE_USER` + `SEED_SOURCE_PASSWORD` — la vía
 *      cómoda cuando sólo cambia la rama: se toca el host y el resto queda igual.
 *
 * Si no hay ninguna, no hay fuente y quien llama decide si eso es un error (`db:seed:pull`) o
 * simplemente no sembrar (arranque de la aplicación).
 */
export interface SeedSource {
  readonly connectionString: string;
  readonly ssl: { rejectUnauthorized: boolean } | false;
  /** Host sin credenciales, para registrar a qué rama se apuntó sin filtrar la contraseña. */
  readonly describe: string;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function describeConnection(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    return `${url.host}${url.pathname}`;
  } catch {
    return '(cadena de conexión no interpretable)';
  }
}

export function resolveSeedSource(environment: NodeJS.ProcessEnv = process.env): SeedSource | null {
  // TLS por defecto ACTIVO: la fuente es una base gestionada remota, no un contenedor local. Se
  // apaga explícitamente para apuntar a un PostgreSQL local sin certificado.
  const useSsl = parseBoolean(environment.SEED_SOURCE_SSL, true);
  const rejectUnauthorized = parseBoolean(environment.SEED_SOURCE_SSL_REJECT_UNAUTHORIZED, true);
  const ssl = useSsl ? { rejectUnauthorized } : (false as const);

  const explicitUrl = environment.SEED_SOURCE_DATABASE_URL?.trim();
  if (explicitUrl) {
    return { connectionString: explicitUrl, ssl, describe: describeConnection(explicitUrl) };
  }

  const host = environment.SEED_SOURCE_HOST?.trim();
  const database = environment.SEED_SOURCE_DB?.trim();
  const user = environment.SEED_SOURCE_USER?.trim();
  const password = environment.SEED_SOURCE_PASSWORD ?? '';
  if (!host || !database || !user) return null;

  const port = environment.SEED_SOURCE_PORT?.trim() || '5432';
  const connectionString = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
  return { connectionString, ssl, describe: `${host}:${port}/${database}` };
}

/** Igual que `resolveSeedSource`, pero falla con un mensaje accionable en vez de devolver `null`. */
export function requireSeedSource(environment: NodeJS.ProcessEnv = process.env): SeedSource {
  const source = resolveSeedSource(environment);
  if (source) return source;
  throw new Error(
    'No hay origen de semillas configurado. Declara SEED_SOURCE_DATABASE_URL, o bien ' +
      'SEED_SOURCE_HOST + SEED_SOURCE_DB + SEED_SOURCE_USER + SEED_SOURCE_PASSWORD. ' +
      'Apuntan a la rama de PostgreSQL que publica el conjunto sembrado (ver docs/base-de-datos/semillas.md).',
  );
}
