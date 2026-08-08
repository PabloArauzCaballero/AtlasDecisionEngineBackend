/**
 * Router de fuentes de datos: traduce «módulo + operación + consistencia» a una conexión.
 *
 * Toda la resolución ocurre aquí y en `routing-rules.ts`; ningún módulo de dominio
 * nombra una conexión. Valida las reglas al arrancar y falla temprano —sin exponer
 * secretos— ante una regla imposible: conexión inexistente, escritura contra una conexión
 * de solo lectura, uso de la conexión administrativa o capacidad que el motor no ofrece.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ADMIN_CONNECTION,
  ConnectionRegistryService,
  WRITE_CONNECTION,
} from '../connections/connection-registry.service';
import { PostgresConnection } from '../connections/postgres-connection';
import {
  DataSourceConfigurationError,
  UnsupportedCapabilityError,
} from '../errors/persistence-errors';
import {
  type AdapterCapabilities,
  capabilitiesOf,
  missingCapabilities,
} from '../ports/adapter-capabilities';
import type {
  ConnectionRole,
  ConsistencyLevel,
  DataConnection,
  DataEngine,
  DataOperation,
} from '../ports/data-source.types';
import {
  BASE_ROUTING_RULES,
  DEFAULT_MODULE,
  effectiveRule,
  mergeRoutingRules,
  parseRoutingOverrides,
  type RoutingRules,
} from './routing-rules';

export interface DataRoute {
  readonly module: string;
  readonly operation: DataOperation;
  readonly consistency?: ConsistencyLevel;
}

export interface ResolvedDataSource {
  readonly connectionName: string;
  readonly connection: DataConnection;
  readonly engine: DataEngine;
  readonly role: ConnectionRole;
  readonly capabilities: AdapterCapabilities;
  readonly consistency: ConsistencyLevel;
  /**
   * True cuando la ruta pidió lectura pero se resolvió contra la escritura por exigencia
   * de consistencia. Se anota en la métrica: una lectura «eventual» que en realidad va al
   * primario es carga que alguien debe poder ver.
   */
  readonly upgradedToPrimary: boolean;
}

@Injectable()
export class DataSourceRouterService {
  private readonly logger = new Logger(DataSourceRouterService.name);
  private readonly rules: RoutingRules;

  constructor(
    private readonly registry: ConnectionRegistryService,
    config: ConfigService,
  ) {
    this.rules = mergeRoutingRules(
      BASE_ROUTING_RULES,
      parseRoutingOverrides(config.get<string>('DATA_ROUTING_RULES')),
    );
    this.validateRules();
  }

  /**
   * Recorre TODAS las reglas al arrancar, no solo las que alguien use hoy. Una regla que
   * apunta a una conexión inexistente debe impedir el arranque, no esperar a la primera
   * petición del módulo afectado a las tres de la mañana.
   */
  private validateRules(): void {
    for (const moduleName of Object.keys(this.rules)) {
      const rule = effectiveRule(this.rules, moduleName);
      for (const [operation, connectionName] of [
        ['read', rule.read],
        ['write', rule.write],
      ] as const) {
        if (connectionName === ADMIN_CONNECTION) {
          throw new DataSourceConfigurationError(
            `Module "${moduleName}" routes ${operation} to "${ADMIN_CONNECTION}"; the administrative connection is reserved for migrations and provisioning`,
          );
        }
        if (!this.registry.has(connectionName)) {
          throw new DataSourceConfigurationError(
            `Module "${moduleName}" routes ${operation} to unknown connection "${connectionName}"`,
          );
        }
        const connection = this.registry.get(connectionName);
        if (operation === 'write' && connection.role === 'read') {
          throw new DataSourceConfigurationError(
            `Module "${moduleName}" routes write operations to "${connectionName}", which is registered as read-only`,
          );
        }
        const missing = missingCapabilities(connection.engine, rule.requires);
        if (missing.length) {
          throw new UnsupportedCapabilityError(
            `Module "${moduleName}" requires ${missing.join(', ')}, which "${connection.engine}" does not provide`,
            { connectionName, engine: connection.engine },
          );
        }
      }
    }
    this.logger.log(
      `Routing rules validated for ${Object.keys(this.rules).length} module entries over connections [${this.registry
        .names()
        .join(', ')}]`,
    );
  }

  resolve(route: DataRoute): ResolvedDataSource {
    const rule = effectiveRule(this.rules, route.module);
    const consistency = route.consistency ?? rule.consistency;

    if (route.operation === 'write') {
      return this.describe(rule.write, consistency, false);
    }

    const target = this.readTargetFor(rule.read, consistency);
    return this.describe(target, consistency, target !== rule.read);
  }

  /**
   * Decide si una lectura puede ir por la conexión de lectura o debe subir al primario.
   *
   * La distinción que importa no es «hay dos conexiones» sino «hay dos servidores». Dos
   * roles distintos contra la misma base (Escenario B: `atlas_reader` / `atlas_writer`)
   * ven exactamente los mismos datos, así que ahí una lectura fuerte es legítima. Una
   * réplica —otro host, otro puerto u otra base— va por detrás, y servir desde ella una
   * lectura declarada fuerte sería afirmar una consistencia que no existe.
   */
  private readTargetFor(readConnection: string, consistency: ConsistencyLevel): string {
    if (consistency === 'eventual') return readConnection;
    if (consistency === 'read-after-write') return WRITE_CONNECTION;
    return this.isReplica(readConnection) ? WRITE_CONNECTION : readConnection;
  }

  /** ¿La conexión de lectura vive en otro servidor o base que la de escritura? */
  isReplica(readConnection: string): boolean {
    if (!this.registry.has(readConnection)) return false;
    const read = this.registry.get(readConnection);
    const write = this.registry.get(WRITE_CONNECTION);
    if (read === write) return false;
    if (!(read instanceof PostgresConnection) || !(write instanceof PostgresConnection))
      return true;
    return (
      read.target.host !== write.target.host ||
      read.target.port !== write.target.port ||
      read.target.database !== write.target.database
    );
  }

  private describe(
    connectionName: string,
    consistency: ConsistencyLevel,
    upgradedToPrimary: boolean,
  ): ResolvedDataSource {
    const connection = this.registry.get(connectionName);
    return {
      connectionName,
      connection,
      engine: connection.engine,
      role: connection.role,
      capabilities: capabilitiesOf(connection.engine),
      consistency,
      upgradedToPrimary,
    };
  }

  /** Vista de solo lectura de las reglas efectivas, para documentación y diagnóstico. */
  effectiveRules(): Record<string, ReturnType<typeof effectiveRule>> {
    const modules = new Set([DEFAULT_MODULE, ...Object.keys(this.rules)]);
    return Object.fromEntries(
      [...modules].sort().map((moduleName) => [moduleName, effectiveRule(this.rules, moduleName)]),
    );
  }
}
