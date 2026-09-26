/**
 * Salud de las fuentes de datos y muestreo de pools.
 *
 * Lo que se publica es el nombre lógico, el motor, el rol y el veredicto. Nunca el host,
 * el usuario, la base ni la cadena de conexión: `/health/data-sources` es un endpoint
 * público, y una sonda que revela la topología interna es reconocimiento gratis.
 *
 * También registra el muestreador de pools contra `MetricsService`, así que las series
 * `atlas_database_pool_connections` se calculan en el instante del scrape en vez de por un
 * temporizador propio.
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { MetricsService } from '../../observability/metrics.service';
import { ConnectionRegistryService } from '../connections/connection-registry.service';
import type { ConnectionHealth } from '../ports/data-source.types';
import { DataSourceRouterService } from '../routing/data-source-router.service';

export interface DataSourceReport {
  /** `up` si todas responden, `degraded` si alguna está caída. */
  readonly status: 'up' | 'degraded';
  readonly connections: Record<
    string,
    { status: string; role: string; engine: string; latencyMs?: number; detail?: string }
  >;
  /** Reglas efectivas por módulo: qué conexión sirve cada ruta. */
  readonly routing: Record<string, { read: string; write: string; consistency: string }>;
  readonly timestamp: string;
}

@Injectable()
export class DataSourceHealthService implements OnModuleInit {
  constructor(
    private readonly registry: ConnectionRegistryService,
    private readonly router: DataSourceRouterService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    this.metrics.registerCollector(() => {
      for (const name of this.registry.names()) {
        const stats = this.registry.get(name).poolStats();
        if (stats) this.metrics.setDatabasePool(name, stats);
      }
    });
  }

  async report(): Promise<DataSourceReport> {
    const health = await this.registry.healthAll();
    return {
      status: health.some((entry) => entry.status === 'down') ? 'degraded' : 'up',
      connections: Object.fromEntries(health.map((entry) => [entry.name, describe(entry)])),
      routing: Object.fromEntries(
        Object.entries(this.router.effectiveRules()).map(([moduleName, rule]) => [
          moduleName,
          { read: rule.read, write: rule.write, consistency: rule.consistency },
        ]),
      ),
      timestamp: new Date().toISOString(),
    };
  }
}

function describe(entry: ConnectionHealth) {
  return {
    status: entry.status,
    role: entry.role,
    engine: entry.engine,
    ...(entry.latencyMs === undefined ? {} : { latencyMs: entry.latencyMs }),
    ...(entry.detail === undefined ? {} : { detail: entry.detail }),
  };
}
