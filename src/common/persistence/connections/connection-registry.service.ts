/**
 * Registro central de conexiones de datos.
 *
 * Resuelve conexiones por nombre lógico. Es el único sitio del sistema que sabe qué
 * cadena de conexión hay detrás de `postgres-read`, y por eso es también el único sitio
 * donde se decide si dos rutas comparten pool.
 *
 * Dos decisiones que conviene no deshacer:
 *
 *  - Las conexiones PostgreSQL se construyen en el constructor, sin I/O. Así
 *    `PrismaService` puede tomar el pool de la conexión de escritura durante su propia
 *    construcción; la conexión real se establece en `connectAll()`, ya dentro del ciclo
 *    de vida de Nest.
 *  - `postgres-admin` NO se registra. Existe como nombre reservado que el router rechaza,
 *    porque una conexión administrativa alcanzable por inyección acaba, tarde o temprano,
 *    inyectada en un caso de uso ordinario (§21, §26).
 */
import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectionUnavailableError,
  DataSourceConfigurationError,
} from '../errors/persistence-errors';
import type { ConnectionHealth, DataConnection } from '../ports/data-source.types';
import { PostgresConnection } from './postgres-connection';

export const WRITE_CONNECTION = 'postgres-write';
export const READ_CONNECTION = 'postgres-read';
/** Nombre reservado: el aprovisionamiento y las migraciones lo usan fuera del runtime. */
export const ADMIN_CONNECTION = 'postgres-admin';

@Injectable()
export class ConnectionRegistryService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ConnectionRegistryService.name);
  private readonly connections = new Map<string, DataConnection>();
  /** `postgres-read` apunta al mismo objeto que `postgres-write`. */
  private readonly readSharesWriteConnection: boolean;

  constructor(private readonly config: ConfigService) {
    const write = this.buildPostgres(WRITE_CONNECTION, this.writeUrl(), 'write');
    this.register(write);

    const readUrl = this.readUrl();
    const read = this.buildPostgres(READ_CONNECTION, readUrl, 'read');
    if (read.fingerprint === write.fingerprint) {
      // Escenario A: misma conexión física y lógica. Se registra el MISMO objeto bajo los
      // dos nombres en vez de abrir un segundo pool idéntico; el router sigue resolviendo
      // por nombre, así que separar las rutas más adelante es cambiar una variable.
      this.readSharesWriteConnection = true;
      this.connections.set(READ_CONNECTION, write);
      // El pool descartado nunca llegó a conectar; se cierra igualmente para no dejar
      // temporizadores del cliente vivos, y su fallo no puede tumbar el arranque.
      void read.close().catch(() => undefined);
      this.logger.log(
        `Read path shares the write connection (identical fingerprint); a single pool is used`,
      );
    } else {
      this.readSharesWriteConnection = false;
      this.register(read);
      this.logger.log(`Read path uses a dedicated connection and pool`);
    }
  }

  private writeUrl(): string {
    // DATABASE_URL sigue siendo la variable de siempre: un despliegue que no declare nada
    // nuevo conserva exactamente el comportamiento anterior.
    return (
      this.config.get<string>('DATABASE_WRITE_URL') ||
      this.config.getOrThrow<string>('DATABASE_URL')
    );
  }

  private readUrl(): string {
    return this.config.get<string>('DATABASE_READ_URL') || this.writeUrl();
  }

  private buildPostgres(name: string, url: string, role: 'read' | 'write'): PostgresConnection {
    const poolMax =
      role === 'read'
        ? (this.config.get<number>('DATABASE_READ_POOL_MAX') ??
          this.config.get<number>('DATABASE_POOL_MAX') ??
          15)
        : (this.config.get<number>('DATABASE_POOL_MAX') ?? 15);
    return new PostgresConnection({
      name,
      url,
      role,
      poolMax,
      connectionTimeoutMs: this.config.get<number>('DATABASE_CONNECTION_TIMEOUT_MS') ?? 5_000,
      idleTimeoutMs: this.config.get<number>('DATABASE_IDLE_TIMEOUT_MS') ?? 30_000,
      statementTimeoutMs: this.config.get<number>('DATABASE_STATEMENT_TIMEOUT_MS') ?? 30_000,
      applicationName: 'atlas-decision-engine',
    });
  }

  register(connection: DataConnection): void {
    if (connection.name === ADMIN_CONNECTION) {
      throw new DataSourceConfigurationError(
        `"${ADMIN_CONNECTION}" is reserved for migrations and provisioning and must not be registered in the runtime registry`,
      );
    }
    if (this.connections.has(connection.name)) {
      throw new DataSourceConfigurationError(`Duplicate data connection name "${connection.name}"`);
    }
    this.connections.set(connection.name, connection);
  }

  has(name: string): boolean {
    return this.connections.has(name);
  }

  get(name: string): DataConnection {
    const connection = this.connections.get(name);
    if (!connection) {
      throw new DataSourceConfigurationError(`Unknown data connection "${name}"`);
    }
    return connection;
  }

  /** Acceso tipado para quien necesita el pool PostgreSQL (los clientes Prisma). */
  postgres(name: string): PostgresConnection {
    const connection = this.get(name);
    if (!(connection instanceof PostgresConnection)) {
      throw new DataSourceConfigurationError(`Connection "${name}" is not a PostgreSQL connection`);
    }
    return connection;
  }

  /** True cuando lectura y escritura resuelven al mismo pool (Escenario A). */
  get readSharesWrite(): boolean {
    return this.readSharesWriteConnection;
  }

  names(): string[] {
    return [...this.connections.keys()].sort();
  }

  /** Objetos distintos, aunque estén registrados bajo varios nombres. */
  private distinctConnections(): DataConnection[] {
    return [...new Set(this.connections.values())];
  }

  /**
   * Las conexiones se establecen aquí, antes que cualquier cliente.
   *
   * `PrismaModule` importa este módulo, así que Nest inicializa este proveedor primero:
   * cuando `PrismaService.onModuleInit` ejecuta su primera consulta, el pool ya validó
   * que la base responde y un fallo de configuración ya abortó el arranque.
   */
  async onModuleInit(): Promise<void> {
    await this.connectAll();
  }

  /**
   * El cierre va en `onApplicationShutdown` y no en `onModuleDestroy` a propósito: Nest
   * ejecuta primero todos los `onModuleDestroy`, y ahí es donde los clientes Prisma hacen
   * su `$disconnect()`. Cerrar el pool antes dejaría esa desconexión sin transporte.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.closeAll();
  }

  async connectAll(): Promise<void> {
    for (const connection of this.distinctConnections()) {
      try {
        await connection.connect();
      } catch (error) {
        throw new ConnectionUnavailableError(
          `Data connection "${connection.name}" could not be established`,
          { connectionName: connection.name, engine: connection.engine },
          error,
        );
      }
    }
  }

  async healthAll(): Promise<ConnectionHealth[]> {
    // Por nombre lógico y no por objeto: si lectura y escritura comparten pool, el
    // consumidor de la sonda debe seguir viendo las dos rutas que él conoce, cada una con
    // el nombre bajo el que está registrada.
    return Promise.all(
      [...this.connections.entries()].map(async ([name, connection]) => ({
        ...(await connection.healthCheck()),
        name,
      })),
    );
  }

  async closeAll(): Promise<void> {
    for (const connection of this.distinctConnections()) {
      try {
        await connection.close();
      } catch (error) {
        this.logger.warn(
          `Failed to close connection "${connection.name}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
