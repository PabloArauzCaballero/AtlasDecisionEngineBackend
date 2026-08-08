/**
 * Vocabulario común de la superficie de persistencia: motores, proveedores, roles de
 * conexión y niveles de consistencia.
 *
 * Vive en `ports/` y no importa nada de infraestructura a propósito: es el único
 * vocabulario que la capa de aplicación puede nombrar. Un caso de uso puede decir
 * «necesito lectura fuerte del módulo runtime»; no puede decir «usa el pool de Prisma».
 */

/** Motores que el registro sabe describir. Añadir uno exige declarar sus capacidades. */
export const DATA_ENGINES = [
  'postgresql',
  'redis',
  'mysql',
  'mongodb',
  'opensearch',
  'clickhouse',
] as const;
export type DataEngine = (typeof DATA_ENGINES)[number];

/**
 * Proveedor = forma de despliegue, no semántica de datos. Cambiar de proveedor ajusta
 * pooling, TLS y límites; nunca duplica el adaptador del motor (§5 del plan de datos).
 */
export const DATA_PROVIDERS = [
  'generic',
  'local',
  'docker',
  'neon',
  'supabase',
  'aws-rds',
  'aws-aurora',
  'azure-database',
  'google-cloud-sql',
  'upstash',
  'kubernetes',
] as const;
export type DataProvider = (typeof DATA_PROVIDERS)[number];

/**
 * Rol de una conexión registrada.
 *
 * `admin` existe para migraciones y aprovisionamiento y NUNCA se inyecta en un caso de
 * uso: el registro rechaza resolverla desde el router (ver `DataSourceRouterService`).
 */
export type ConnectionRole = 'read' | 'write' | 'read-write' | 'admin';

/** Operación lógica que pide el llamante. El router traduce esto a una conexión concreta. */
export type DataOperation = 'read' | 'write';

/**
 * Nivel de consistencia pedido por el caso de uso.
 *
 * `read-after-write` no es sinónimo de `strong`: significa «acabo de escribir y necesito
 * verlo», y por eso se resuelve contra la conexión de escritura aunque exista réplica.
 */
export type ConsistencyLevel = 'strong' | 'eventual' | 'read-after-write';

/** Qué hacer cuando la ruta de lectura falla. Nunca hay degradación silenciosa (§33). */
export type ReadFallbackStrategy = 'fail-fast' | 'fallback-to-primary';

export interface ConnectionHealth {
  readonly name: string;
  readonly engine: DataEngine;
  readonly role: ConnectionRole;
  readonly status: 'up' | 'down' | 'unknown';
  readonly latencyMs?: number;
  /** Nunca contiene host, usuario ni contraseña: la respuesta de salud es pública. */
  readonly detail?: string;
}

/** Estadísticas de pool que el registro publica como métricas y en `/health/data-sources`. */
export interface ConnectionPoolStats {
  readonly total: number;
  readonly idle: number;
  readonly waiting: number;
}

/**
 * Una conexión registrada. La implementación concreta (pg, ioredis, …) vive en
 * `connections/`; el resto del sistema solo ve esta forma.
 */
export interface DataConnection {
  readonly name: string;
  readonly engine: DataEngine;
  readonly provider: DataProvider;
  readonly role: ConnectionRole;
  /** Huella saneada (sin credenciales) usada para detectar conexiones equivalentes. */
  readonly fingerprint: string;
  connect(): Promise<void>;
  healthCheck(): Promise<ConnectionHealth>;
  poolStats(): ConnectionPoolStats | undefined;
  close(): Promise<void>;
}

/** Contexto de una lectura. Opcional: sin él se aplica la política por defecto del módulo. */
export interface ReadContext {
  readonly consistency?: ConsistencyLevel;
  readonly tenantId?: string;
}

/** Contexto de una escritura. `transaction` es opaco para la aplicación a propósito. */
export interface WriteContext {
  readonly transaction?: TransactionContext;
  readonly tenantId?: string;
}

/**
 * Handle de transacción. Es deliberadamente opaco: si expusiera el cliente del ORM, la
 * capa de aplicación podría emitir consultas por su cuenta y el desacoplamiento sería
 * decorativo. Solo el adaptador que lo creó sabe desenvolverlo.
 */
export interface TransactionContext {
  readonly connectionName: string;
  readonly engine: DataEngine;
}

/** Gestor de transacciones de la ruta de escritura (§30). */
export interface TransactionManager {
  execute<T>(operation: (transaction: TransactionContext) => Promise<T>): Promise<T>;
}
