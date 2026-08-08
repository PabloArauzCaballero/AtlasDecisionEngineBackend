/**
 * Conexión PostgreSQL registrada: dueña del pool `pg` y de su ciclo de vida.
 *
 * El cliente de Prisma NO vive aquí. Esta clase posee el pool, la huella, la sonda de
 * salud y el cierre ordenado; Prisma se monta encima como adaptador. Esa división es lo
 * que permite que lectura y escritura compartan un único pool cuando apuntan al mismo
 * sitio (Escenario A) sin que ninguno de los dos clientes sepa que lo comparte.
 */
import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { normalizePostgresError } from '../errors/postgres-error-mapper';
import type {
  ConnectionHealth,
  ConnectionPoolStats,
  ConnectionRole,
  DataConnection,
  DataProvider,
} from '../ports/data-source.types';
import {
  type ConnectionTarget,
  describeTarget,
  fingerprintOf,
  parseConnectionTarget,
} from './connection-fingerprint';

export interface PostgresConnectionOptions {
  readonly name: string;
  readonly url: string;
  readonly role: ConnectionRole;
  readonly poolMax: number;
  readonly connectionTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly applicationName: string;
}

export class PostgresConnection implements DataConnection {
  readonly engine = 'postgresql' as const;
  readonly name: string;
  readonly role: ConnectionRole;
  readonly provider: DataProvider;
  readonly fingerprint: string;
  readonly target: ConnectionTarget;
  readonly pool: Pool;

  private readonly logger = new Logger(PostgresConnection.name);
  private closed = false;

  constructor(options: PostgresConnectionOptions) {
    this.name = options.name;
    this.role = options.role;
    this.target = parseConnectionTarget(options.url, 'postgresql', `connection "${options.name}"`);
    this.provider = this.target.provider;
    this.fingerprint = fingerprintOf(this.target);
    const statementTimeout = Math.trunc(options.statementTimeoutMs);
    this.pool = new Pool({
      connectionString: options.url,
      max: options.poolMax,
      connectionTimeoutMillis: options.connectionTimeoutMs,
      idleTimeoutMillis: options.idleTimeoutMs,
      // El nombre de aplicación lleva el nombre lógico de la conexión, así que
      // `pg_stat_activity` distingue de un vistazo qué ruta abrió cada sesión.
      application_name: `${options.applicationName}:${options.name}`,
      options: `-c statement_timeout=${statementTimeout} -c idle_in_transaction_session_timeout=${statementTimeout}`,
    });
    this.pool.on('error', (error) => {
      // El pool emite errores de sesiones ociosas fuera de toda petición; sin este
      // manejador Node los convierte en un 'error' no capturado y tumba el proceso.
      process.stderr.write(
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'error',
          context: 'PostgresPool',
          connection: this.name,
          message: error.message,
        })}\n`,
      );
    });
  }

  async connect(): Promise<void> {
    try {
      await this.pool.query('SELECT 1');
      this.logger.log(`Connection "${this.name}" ready (${describeTarget(this.target)})`);
    } catch (error) {
      throw normalizePostgresError(error, {
        connectionName: this.name,
        operation: 'connect',
      });
    }
  }

  async healthCheck(): Promise<ConnectionHealth> {
    const startedAt = Date.now();
    try {
      await this.pool.query('SELECT 1');
      return {
        name: this.name,
        engine: this.engine,
        role: this.role,
        status: 'up',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const normalized = normalizePostgresError(error, {
        connectionName: this.name,
        operation: 'healthCheck',
      });
      this.logger.error(`Health check failed for "${this.name}": ${normalized.message}`);
      // `detail` lleva el NOMBRE del error normalizado, no el texto del driver: la
      // respuesta de `/health/data-sources` es pública y el mensaje crudo revela
      // host, puerto y versión del servidor.
      return {
        name: this.name,
        engine: this.engine,
        role: this.role,
        status: 'down',
        latencyMs: Date.now() - startedAt,
        detail: normalized.name,
      };
    }
  }

  poolStats(): ConnectionPoolStats {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };
  }

  /** Idempotente: el registro y los clientes que la usan pueden pedir el cierre en cualquier orden. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }
}
