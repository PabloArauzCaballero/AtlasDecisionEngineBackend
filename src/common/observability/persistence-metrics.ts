import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram } from 'prom-client';
import { MetricsRegistry } from './metrics-registry';

/**
 * Métricas de la capa de persistencia: operaciones por conexión, degradaciones a primario, fallos de conexión y estado de los pools.
 */
@Injectable()
export class PersistenceMetrics {
  // --- Persistencia: rutas de lectura/escritura, pools y fallback ---
  //
  // Todas las etiquetas son catálogos cerrados del propio código (nombres lógicos de
  // conexión, nombres de módulo, nombres de método de un puerto), nunca entrada del
  // llamante: una etiqueta abierta aquí haría explotar la cardinalidad de la serie.

  private readonly databaseOperations = new Counter({
    name: 'atlas_database_operation_total',
    help: 'Operaciones de persistencia por conexión lógica, módulo y resultado.',
    labelNames: ['connection', 'engine', 'module', 'operation', 'outcome'],
    registers: [],
  });

  private readonly databaseOperationDuration = new Histogram({
    name: 'atlas_database_operation_duration_ms',
    help: 'Duración de una operación de persistencia, en milisegundos.',
    labelNames: ['connection', 'module', 'operation'],
    buckets: [1, 2, 5, 10, 25, 50, 100, 250, 500, 1_000, 5_000],
    registers: [],
  });

  /**
   * Degradaciones de la ruta de lectura al primario. Nunca debe ser silenciosa: si esta
   * serie sube, la réplica está caída o retrasada y el primario está absorbiendo carga
   * que nadie planificó.
   */
  private readonly databaseFallbacks = new Counter({
    name: 'atlas_database_fallback_total',
    help: 'Lecturas servidas por el primario tras fallar la conexión de lectura.',
    labelNames: ['from_connection', 'to_connection', 'reason'],
    registers: [],
  });

  private readonly databaseConnectionFailures = new Counter({
    name: 'atlas_database_connection_failures_total',
    help: 'Fallos de conexión observados por conexión lógica.',
    labelNames: ['connection'],
    registers: [],
  });

  private readonly databasePool = new Gauge({
    name: 'atlas_database_pool_connections',
    help: 'Conexiones del pool por conexión lógica y estado (total | idle | waiting).',
    labelNames: ['connection', 'state'],
    registers: [],
  });

  constructor(shared: MetricsRegistry = new MetricsRegistry()) {
    shared.registry.registerMetric(this.databaseOperations);
    shared.registry.registerMetric(this.databaseOperationDuration);
    shared.registry.registerMetric(this.databaseFallbacks);
    shared.registry.registerMetric(this.databaseConnectionFailures);
    shared.registry.registerMetric(this.databasePool);
  }

  /** `outcome` ∈ ok | error. */
  recordDatabaseOperation(labels: {
    connection: string;
    engine: string;
    module: string;
    operation: string;
    outcome: 'ok' | 'error';
    durationMs: number;
  }): void {
    const { connection, engine, module, operation, outcome, durationMs } = labels;
    this.databaseOperations.inc({ connection, engine, module, operation, outcome });
    this.databaseOperationDuration.observe({ connection, module, operation }, durationMs);
  }

  /** `reason` es el NOMBRE del error normalizado, nunca el mensaje del driver. */
  recordDatabaseFallback(fromConnection: string, toConnection: string, reason: string): void {
    this.databaseFallbacks.inc({
      from_connection: fromConnection,
      to_connection: toConnection,
      reason: reason || 'UNKNOWN',
    });
  }

  recordDatabaseConnectionFailure(connection: string): void {
    this.databaseConnectionFailures.inc({ connection });
  }

  setDatabasePool(
    connection: string,
    stats: { total: number; idle: number; waiting: number },
  ): void {
    this.databasePool.set({ connection, state: 'total' }, stats.total);
    this.databasePool.set({ connection, state: 'idle' }, stats.idle);
    this.databasePool.set({ connection, state: 'waiting' }, stats.waiting);
  }
}
