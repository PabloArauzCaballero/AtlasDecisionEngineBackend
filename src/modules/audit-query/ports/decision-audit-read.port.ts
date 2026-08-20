/**
 * Puerto de lectura del módulo de consulta de auditoría.
 *
 * Las operaciones se nombran por intención de negocio —«busca ejecuciones», «lee un lote
 * de la cadena»— y ningún tipo de Prisma aparece en la firma. El servicio depende de esta
 * interfaz; qué motor la implementa y contra qué conexión se resuelve es asunto del
 * adaptador y del router.
 *
 * Tampoco devuelve la forma de respuesta HTTP: entrega filas y total, y es el servicio
 * quien arma la página. Así el contrato de la API puede cambiar sin tocar adaptadores.
 *
 * Es el puerto piloto de la migración progresiva (§47): el resto de los módulos siguen
 * hablando con `PrismaService` mientras este demuestra la separación de rutas de punta a
 * punta, con interruptor para volver atrás sin desplegar.
 */
import type { CountedRows } from '../../../common/persistence/ports/repository.port';

export const DECISION_AUDIT_READ_PORT = Symbol('DecisionAuditReadPort');

/**
 * Proyección de lectura opaca.
 *
 * El módulo no inspecciona estas filas: las sirve. Tiparlas con el payload generado por
 * Prisma metería el ORM dentro del puerto, que es exactamente lo que este rediseño existe
 * para impedir. Lo que sí se tipa es todo aquello sobre lo que hay lógica —la cadena de
 * auditoría y los agregados—, más abajo.
 */
export type AuditReadModel = Record<string, unknown>;

/** Fila de auditoría por cursor: la paginación keyset necesita la clave de orden. */
export type AuditEventRow = AuditReadModel & { id: bigint };

/** Filtro de ejecuciones ya normalizado por el servicio (fechas como `Date`, no texto). */
export interface ExecutionSearchCriteria {
  readonly tenantId: bigint;
  readonly outcome?: string;
  readonly requestId?: string;
  readonly artifactCode?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly skip: number;
  readonly take: number;
}

export interface AuditEventCriteria {
  readonly tenantId: bigint;
  readonly eventType?: string;
  readonly aggregateType?: string;
  readonly actorId?: string;
  readonly from?: Date;
  readonly to?: Date;
}

export interface AuditEventPageCriteria extends AuditEventCriteria {
  readonly skip: number;
  readonly take: number;
}

export interface AuditEventCursorCriteria extends AuditEventCriteria {
  /** Clave de la que seguir, exclusiva y descendente. Ausente en la primera página. */
  readonly beforeId?: bigint;
  /** Incluye la fila centinela con que el servicio detecta si hay página siguiente. */
  readonly take: number;
}

/** Lote de la cadena de auditoría, recorrido por clave primaria ascendente. */
export interface AuditChainBatchCriteria {
  readonly tenantId: bigint;
  readonly afterId: bigint;
  readonly batchSize: number;
}

/** Evento tal y como lo necesita la verificación de la cadena. */
export interface AuditChainEvent {
  readonly id: bigint;
  readonly tenantId: bigint;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly actorId: string;
  readonly requestId: string | null;
  readonly payloadJson: unknown;
  readonly canonicalPayload: string | null;
  readonly previousHash: string | null;
  readonly eventHash: string;
  readonly hashKeyId: string;
}

export interface ExecutionMetrics {
  readonly total: number;
  /** `outcome` es nulo mientras la ejecución no ha producido un resultado de negocio. */
  readonly outcomes: Array<{ outcome: string | null; count: number }>;
  readonly statuses: Array<{ status: string; count: number }>;
  readonly latencyMs: {
    readonly _avg: { durationMs: number | null };
    readonly _max: { durationMs: number | null };
    readonly _min: { durationMs: number | null };
  };
}

export interface DecisionAuditReadPort {
  /** Detalle completo de una ejecución, o `null` si el tenant no la tiene. */
  findExecutionById(tenantId: bigint, executionId: bigint): Promise<AuditReadModel | null>;
  searchExecutions(criteria: ExecutionSearchCriteria): Promise<CountedRows<AuditReadModel>>;
  listAuditEvents(criteria: AuditEventPageCriteria): Promise<CountedRows<AuditReadModel>>;
  listAuditEventsByCursor(criteria: AuditEventCursorCriteria): Promise<AuditEventRow[]>;
  /** Lote ordenado por id ascendente; vacío cuando la cadena se agotó. */
  readAuditChainBatch(criteria: AuditChainBatchCriteria): Promise<AuditChainEvent[]>;
  executionMetrics(tenantId: bigint, artifactCode?: string): Promise<ExecutionMetrics>;
}
