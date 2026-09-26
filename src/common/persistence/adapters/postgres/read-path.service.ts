/**
 * Ejecutor de la ruta de lectura.
 *
 * Es el único punto donde un adaptador de lectura obtiene un cliente. Concentra aquí
 * cuatro cosas que, repartidas por cada adaptador, se aplicarían de forma desigual:
 *
 *  1. Enrutamiento — pregunta al router qué conexión corresponde a este módulo y a esta
 *     consistencia, en vez de que el adaptador elija.
 *  2. Interruptor — `DATA_READ_ROUTING_ENABLED=false` devuelve todo a la conexión de
 *     escritura sin desplegar nada. Es el rollback de la separación de rutas.
 *  3. Fallback — si la conexión de lectura no está disponible y el fallback está activo,
 *     reintenta contra el primario y lo DECLARA (log estructurado + métrica). Nunca hay
 *     degradación silenciosa: una réplica caída que nadie ve es una réplica que no existe.
 *  4. Normalización y medida — todo error sale como error de persistencia tipado, y toda
 *     operación deja duración y resultado por conexión y módulo.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@prisma/client';
import { RequestContextService } from '../../../context/request-context.service';
import { MetricsService } from '../../../observability/metrics.service';
import { PrismaReadService } from '../../../prisma/prisma-read.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { READ_CONNECTION, WRITE_CONNECTION } from '../../connections/connection-registry.service';
import {
  ConnectionUnavailableError,
  DataSourceConfigurationError,
} from '../../errors/persistence-errors';
import { normalizePostgresError } from '../../errors/postgres-error-mapper';
import type { ConsistencyLevel, ReadContext } from '../../ports/data-source.types';
import { DataSourceRouterService } from '../../routing/data-source-router.service';

/** Cliente expuesto a un adaptador: la superficie de Prisma, sin los extras de escritura. */
export type ReadClient = PrismaClient;

@Injectable()
export class ReadPathService {
  private readonly logger = new Logger(ReadPathService.name);
  private readonly routingEnabled: boolean;
  private readonly fallbackToPrimary: boolean;

  constructor(
    private readonly router: DataSourceRouterService,
    private readonly readClient: PrismaReadService,
    private readonly writeClient: PrismaService,
    private readonly metrics: MetricsService,
    private readonly requestContext: RequestContextService,
    config: ConfigService,
  ) {
    this.routingEnabled = config.get<boolean>('DATA_READ_ROUTING_ENABLED') ?? false;
    this.fallbackToPrimary = config.get<boolean>('ENABLE_PRIMARY_READ_FALLBACK') ?? true;
  }

  /**
   * Ejecuta una lectura del módulo indicado sobre el cliente que corresponda.
   *
   * `operation` es el nombre del método del puerto (`searchExecutions`), no SQL: es una
   * etiqueta de métrica y debe venir de un catálogo cerrado del código.
   */
  async run<T>(
    moduleName: string,
    operation: string,
    query: (client: ReadClient) => Promise<T>,
    context?: ReadContext,
  ): Promise<T> {
    const resolved = this.resolve(moduleName, context?.consistency);
    const client = this.clientFor(resolved.connectionName);
    const startedAt = Date.now();
    try {
      const result = await query(client);
      this.metrics.recordDatabaseOperation({
        connection: resolved.connectionName,
        engine: resolved.engine,
        module: moduleName,
        operation,
        outcome: 'ok',
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      const normalized = normalizePostgresError(error, {
        connectionName: resolved.connectionName,
        operation,
      });
      this.metrics.recordDatabaseOperation({
        connection: resolved.connectionName,
        engine: resolved.engine,
        module: moduleName,
        operation,
        outcome: 'error',
        durationMs: Date.now() - startedAt,
      });
      if (
        normalized instanceof ConnectionUnavailableError &&
        resolved.connectionName !== WRITE_CONNECTION
      ) {
        this.metrics.recordDatabaseConnectionFailure(resolved.connectionName);
        if (this.fallbackToPrimary) {
          return this.fallback(moduleName, operation, query, resolved.connectionName, normalized);
        }
      }
      throw normalized;
    }
  }

  /** Reintento contra el primario, declarado en el log con todo lo que hace falta para auditarlo. */
  private async fallback<T>(
    moduleName: string,
    operation: string,
    query: (client: ReadClient) => Promise<T>,
    fromConnection: string,
    cause: Error,
  ): Promise<T> {
    const startedAt = Date.now();
    this.metrics.recordDatabaseFallback(fromConnection, WRITE_CONNECTION, cause.name);
    try {
      const result = await query(this.writeClient);
      this.logger.warn(
        JSON.stringify({
          event: 'read_path_fallback',
          module: moduleName,
          operation,
          from: fromConnection,
          to: WRITE_CONNECTION,
          reason: cause.name,
          durationMs: Date.now() - startedAt,
          outcome: 'served',
          requestId: this.requestContext.get()?.requestId ?? null,
        }),
      );
      return result;
    } catch (error) {
      const normalized = normalizePostgresError(error, {
        connectionName: WRITE_CONNECTION,
        operation,
      });
      this.logger.error(
        JSON.stringify({
          event: 'read_path_fallback',
          module: moduleName,
          operation,
          from: fromConnection,
          to: WRITE_CONNECTION,
          reason: cause.name,
          durationMs: Date.now() - startedAt,
          outcome: 'failed',
          requestId: this.requestContext.get()?.requestId ?? null,
        }),
      );
      throw normalized;
    }
  }

  /**
   * Cliente que corresponde a una conexión resuelta.
   *
   * Solo hay dos clientes PostgreSQL, y una regla de enrutamiento que mande este módulo a
   * una tercera conexión —otro motor, por ejemplo— es un fallo de configuración que la
   * fábrica de adaptadores ya rechaza al arrancar. Si aun así llegara aquí, se declara en
   * vez de servir la consulta por el cliente equivocado, que es un error silencioso.
   */
  private clientFor(connectionName: string): ReadClient {
    if (connectionName === WRITE_CONNECTION) return this.writeClient;
    if (connectionName === READ_CONNECTION) return this.readClient;
    throw new DataSourceConfigurationError(
      `The PostgreSQL read path cannot serve connection "${connectionName}"`,
      { connectionName },
    );
  }

  /** Ruta efectiva de una lectura, con el interruptor ya aplicado. */
  resolve(moduleName: string, consistency?: ConsistencyLevel) {
    if (!this.routingEnabled) {
      return this.router.resolve({
        module: moduleName,
        operation: 'read',
        consistency: 'read-after-write',
      });
    }
    return this.router.resolve({ module: moduleName, operation: 'read', consistency });
  }
}
