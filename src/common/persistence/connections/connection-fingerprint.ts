/**
 * Huella saneada de una conexión: identifica una conexión sin poder reconstruirla.
 *
 * Sirve para decidir si dos rutas apuntan de verdad al mismo sitio y pueden compartir
 * pool (§12). La contraseña nunca entra en la huella —ni siquiera hasheada— porque el
 * valor acaba en logs, métricas y en la salida de `/health/data-sources`. El usuario SÍ
 * entra: dos URLs iguales salvo el rol son conexiones distintas a propósito, y colapsarlas
 * anularía la separación de privilegios que es el objetivo de todo esto.
 */
import { DataSourceConfigurationError } from '../errors/persistence-errors';
import type { DataEngine, DataProvider } from '../ports/data-source.types';

export interface ConnectionTarget {
  readonly engine: DataEngine;
  readonly provider: DataProvider;
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly schema: string;
  readonly ssl: boolean;
}

const DEFAULT_PORTS: Partial<Record<DataEngine, number>> = {
  postgresql: 5432,
  mysql: 3306,
  redis: 6379,
  mongodb: 27017,
  opensearch: 9200,
  clickhouse: 8123,
};

/**
 * Deduce el proveedor por el host. Es una pista para ajustar pooling y TLS, nunca una
 * razón para duplicar el adaptador del motor: `generic` funciona en todos los casos.
 */
export function inferProvider(host: string): DataProvider {
  const lower = host.toLowerCase();
  if (lower.endsWith('.neon.tech')) return 'neon';
  if (lower.includes('supabase.')) return 'supabase';
  if (lower.endsWith('.rds.amazonaws.com')) return 'aws-rds';
  if (lower.includes('.cluster-') && lower.endsWith('.amazonaws.com')) return 'aws-aurora';
  if (lower.endsWith('.database.azure.com')) return 'azure-database';
  if (lower.includes('.upstash.io')) return 'upstash';
  if (lower === 'localhost' || lower === '127.0.0.1' || lower === '::1') return 'local';
  // Un host sin puntos dentro de una red de contenedores es el nombre del servicio.
  if (!lower.includes('.')) return 'docker';
  return 'generic';
}

/**
 * Parsea una URL de conexión sin retener el secreto.
 *
 * `label` solo se usa para el mensaje de error: nombra la variable de entorno culpable
 * sin llegar a imprimir su valor.
 */
export function parseConnectionTarget(
  url: string,
  engine: DataEngine,
  label: string,
): ConnectionTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DataSourceConfigurationError(`${label} is not a valid connection URL`, { engine });
  }
  const host = parsed.hostname;
  if (!host) {
    throw new DataSourceConfigurationError(`${label} does not declare a host`, { engine });
  }
  const port = parsed.port ? Number(parsed.port) : (DEFAULT_PORTS[engine] ?? 0);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'default';
  const sslMode = parsed.searchParams.get('sslmode');
  return {
    engine,
    provider: inferProvider(host),
    host,
    port,
    database,
    user: decodeURIComponent(parsed.username) || 'default',
    schema: parsed.searchParams.get('schema') ?? 'public',
    ssl: sslMode !== null && sslMode !== 'disable',
  };
}

/**
 * Huella estable y sin secretos. Se imprime en logs y salud, así que la contraseña queda
 * fuera por construcción: no se lee del objeto porque el objeto no la tiene.
 */
export function fingerprintOf(target: ConnectionTarget): string {
  return [
    target.engine,
    target.provider,
    `${target.host}:${target.port}`,
    target.database,
    target.schema,
    target.user,
    target.ssl ? 'tls' : 'plain',
  ].join('|');
}

/**
 * ¿Dos rutas apuntan a la misma conexión física y lógica? Solo entonces se comparte pool.
 * Credenciales distintas ⇒ pools distintos aunque el servidor sea el mismo (Escenario B).
 */
export function areEquivalent(left: ConnectionTarget, right: ConnectionTarget): boolean {
  return fingerprintOf(left) === fingerprintOf(right);
}

/** Forma legible para diagnóstico: nunca incluye usuario ni credenciales. */
export function describeTarget(target: ConnectionTarget): string {
  return `${target.engine}://${target.host}:${target.port}/${target.database}?schema=${target.schema}`;
}
