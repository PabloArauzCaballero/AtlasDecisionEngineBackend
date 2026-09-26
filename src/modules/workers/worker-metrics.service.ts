import { Injectable } from '@nestjs/common';
import { Prisma, WorkerRunStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type {
  WorkerCode,
  WorkerIncidentDto,
  WorkerLatencyDto,
  WorkerQueueDto,
  WorkerStatusCountDto,
} from './workers.dto';

/**
 * Salud, latencia, cola e incidencias de un worker adicional (ADR-0026).
 *
 * **Se calcula en PostgreSQL, no en memoria.** Traer las filas y agregarlas en
 * JavaScript obligaría a acotar cuántas se traen, y entonces el percentil ya no
 * describiría la ventana pedida sino las filas que cupieron: una cifra que
 * cambia con el tamaño de la página no es una medida, es una casualidad. Aquí
 * `percentile_cont` recorre la ventana entera y lo que viaja son dos filas.
 *
 * Vive en el módulo de workers y no en uno de observabilidad porque lo que mide
 * es el ciclo de vida de estas tablas, que es justo lo único que los workers
 * comparten. Cada uno conserva su tabla, su cola y su processor.
 */
@Injectable()
export class WorkerMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tabla de ejecuciones de cada worker.
   *
   * `Prisma.raw` no parametriza —es interpolación literal— y por eso el mapa es
   * CERRADO y se indexa con un `WorkerCode` ya validado en el controlador:
   * ningún texto de la petición llega hasta aquí. Un identificador de tabla no
   * se puede pasar como parámetro en SQL, así que la alternativa sería escribir
   * la misma consulta dos veces.
   */
  private static readonly RUN_TABLE: Record<WorkerCode, Prisma.Sql> = {
    'semantic-analysis': Prisma.raw('"decision_semantic_analysis_run"'),
    'bank-statement': Prisma.raw('"decision_bank_statement_run"'),
    'identity-verification': Prisma.raw('"decision_identity_verification_run"'),
    'audio-tts': Prisma.raw('"decision_audio_tts_run"'),
  };

  /** Causas distintas que se publican. Más allá, la lista deja de orientar. */
  private static readonly MAX_INCIDENTS = 20;

  async collect(
    tenantId: bigint,
    worker: WorkerCode,
    windowHours: number,
  ): Promise<{
    windowFrom: Date;
    totalRuns: number;
    finishedRuns: number;
    successRate: number | null;
    statusMix: WorkerStatusCountDto[];
    latency: WorkerLatencyDto;
    queue: WorkerQueueDto;
    incidents: WorkerIncidentDto[];
    lastRunAt: Date | null;
  }> {
    const windowFrom = new Date(Date.now() - windowHours * 3_600_000);
    /*
     * Las dos consultas van dentro de UNA transacción, y no en un `Promise.all`.
     *
     * No es por atomicidad —esto sólo lee—: `applyTenantRls` envuelve las
     * operaciones de modelo y `$transaction`, pero **`$queryRaw` suelto cae al
     * cliente base**, sin fijar `app.tenant_id`. Y la política de estas tablas
     * dice `current_setting('app.tenant_id', true) IS NULL OR tenant_id = …::bigint`:
     * sobre una conexión del pool que ya sirvió a un tenant, el GUC sigue
     * DEFINIDO con cadena vacía, así que no es NULL y `''::bigint` revienta con
     * `22P02`. Falla o no según qué conexión toque, que es la peor clase de
     * fallo.
     *
     * Pasando por `$transaction` el proxy antepone el `set_config`, la RLS
     * aplica de verdad como defensa en profundidad y las dos consultas viajan
     * en una sola ida a la base.
     */
    const [summaryRows, incidents] = await this.prisma.$transaction([
      this.summaryQuery(tenantId, worker, windowFrom),
      this.incidentsQuery(tenantId, worker, windowFrom),
    ]);
    // La consulta siempre devuelve una fila (son subconsultas agregadas), pero
    // un `undefined` aquí produciría un 500 ilegible en vez de un panel vacío.
    const summary = summaryRows[0] ?? EMPTY_SUMMARY;

    const succeeded = summary.succeeded + summary.succeededWithWarnings;
    /*
     * El denominador NO incluye lo derivado a revisión ni lo rechazado, y las
     * razones son distintas. Un documento rechazado es el worker haciendo su
     * trabajo bien —decir que no es un extracto es un acierto, no un fallo— y
     * contarlo como error castigaría al motor por acertar. Un caso en revisión
     * todavía no tiene desenlace: meterlo en cualquiera de los dos lados sería
     * afirmar algo que aún no se sabe. Los dos SÍ salen en `statusMix`, que es
     * donde se ve el hueco que este ratio no cubre.
     */
    const finishedRuns = succeeded + summary.failed;

    return {
      windowFrom,
      totalRuns: summary.total,
      finishedRuns,
      // Las canceladas quedan fuera del denominador: nadie llegó a procesarlas,
      // así que no dicen nada sobre si el worker funciona.
      successRate: finishedRuns > 0 ? (succeeded / finishedRuns) * 100 : null,
      statusMix: statusMix(summary),
      latency: {
        p50Ms: summary.p50Ms,
        p95Ms: summary.p95Ms,
        p99Ms: summary.p99Ms,
        maxMs: summary.maxMs,
        avgWaitMs: summary.avgWaitMs,
        maxWaitMs: summary.maxWaitMs,
        samples: summary.latencySamples,
      },
      queue: {
        queued: summary.queued,
        running: summary.running,
        oldestQueuedAt: summary.oldestQueuedAt,
      },
      incidents,
      lastRunAt: summary.lastRunAt,
    };
  }

  /**
   * Una sola consulta para el reparto por estado, los percentiles y la cola.
   *
   * Las duraciones se pasan a `double precision` en la CTE y no se dejan en
   * `numeric`: `percentile_cont` está definido sobre `double precision`, y el
   * resultado llega al cliente como número de JavaScript en vez de como decimal
   * de Prisma, que habría que convertir en cada uso.
   *
   * La ventana se recorre por `(tenant_id, queued_at)`, que es el índice que ya
   * tienen las dos tablas.
   */
  private summaryQuery(tenantId: bigint, worker: WorkerCode, windowFrom: Date) {
    const table = WorkerMetricsService.RUN_TABLE[worker];
    return this.prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
      WITH ventana AS (
        SELECT status, queued_at, started_at, finished_at
        FROM ${table}
        WHERE tenant_id = ${tenantId} AND queued_at >= ${windowFrom}
      ),
      proceso AS (
        SELECT EXTRACT(EPOCH FROM (finished_at - started_at))::double precision * 1000 AS ms
        FROM ventana
        WHERE started_at IS NOT NULL AND finished_at IS NOT NULL
      ),
      espera AS (
        SELECT EXTRACT(EPOCH FROM (started_at - queued_at))::double precision * 1000 AS ms
        FROM ventana
        WHERE started_at IS NOT NULL
      )
      SELECT
        (SELECT count(*) FROM ventana)::int AS "total",
        (SELECT count(*) FROM ventana WHERE status = 'QUEUED')::int AS "queued",
        (SELECT count(*) FROM ventana WHERE status = 'RUNNING')::int AS "running",
        (SELECT count(*) FROM ventana WHERE status = 'SUCCEEDED')::int AS "succeeded",
        (SELECT count(*) FROM ventana WHERE status = 'SUCCEEDED_WITH_WARNINGS')::int
          AS "succeededWithWarnings",
        (SELECT count(*) FROM ventana WHERE status = 'FAILED')::int AS "failed",
        (SELECT count(*) FROM ventana WHERE status = 'CANCELLED')::int AS "cancelled",
        (SELECT count(*) FROM ventana WHERE status IN ('PENDING_REVIEW', 'IN_REVIEW'))::int
          AS "pendingReview",
        (SELECT count(*) FROM ventana WHERE status = 'PDF_INVALID')::int AS "documentRejected",
        (SELECT count(*) FROM proceso)::int AS "latencySamples",
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) FROM proceso) AS "p50Ms",
        (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) FROM proceso) AS "p95Ms",
        (SELECT percentile_cont(0.99) WITHIN GROUP (ORDER BY ms) FROM proceso) AS "p99Ms",
        (SELECT max(ms) FROM proceso) AS "maxMs",
        (SELECT avg(ms) FROM espera) AS "avgWaitMs",
        (SELECT max(ms) FROM espera) AS "maxWaitMs",
        (SELECT min(queued_at) FROM ventana WHERE status = 'QUEUED') AS "oldestQueuedAt",
        (SELECT max(queued_at) FROM ventana) AS "lastRunAt"
    `);
  }

  /**
   * Fallos de la ventana, agrupados por código y con el rastro del más reciente.
   *
   * `DISTINCT ON` y no una segunda consulta por código: el número de códigos no
   * se conoce de antemano y una consulta por cada uno convertiría un panel en
   * una tormenta de idas y vueltas contra la base.
   */
  private incidentsQuery(tenantId: bigint, worker: WorkerCode, windowFrom: Date) {
    const table = WorkerMetricsService.RUN_TABLE[worker];
    return this.prisma.$queryRaw<WorkerIncidentDto[]>(Prisma.sql`
      WITH fallos AS (
        SELECT coalesce(error_code, 'SIN_CODIGO') AS code, error_message, request_id,
               correlation_id, attempt_count, queued_at
        FROM ${table}
        WHERE tenant_id = ${tenantId} AND queued_at >= ${windowFrom} AND status = 'FAILED'
      ),
      conteo AS (
        SELECT code, count(*)::int AS total FROM fallos GROUP BY code
      ),
      ultimo AS (
        SELECT DISTINCT ON (code) code, error_message, request_id, correlation_id,
               attempt_count, queued_at
        FROM fallos
        ORDER BY code, queued_at DESC
      )
      SELECT c.code AS "code",
             u.error_message AS "message",
             c.total AS "count",
             u.queued_at AS "lastOccurredAt",
             u.request_id AS "lastRequestId",
             u.correlation_id AS "lastCorrelationId",
             u.attempt_count AS "lastAttemptCount"
      FROM conteo c
      JOIN ultimo u ON u.code = c.code
      ORDER BY c.total DESC, u.queued_at DESC
      LIMIT ${WorkerMetricsService.MAX_INCIDENTS}
    `);
  }
}

interface SummaryRow {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  succeededWithWarnings: number;
  failed: number;
  cancelled: number;
  pendingReview: number;
  documentRejected: number;
  latencySamples: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  avgWaitMs: number | null;
  maxWaitMs: number | null;
  oldestQueuedAt: Date | null;
  lastRunAt: Date | null;
}

type Summary = SummaryRow;

const EMPTY_SUMMARY: SummaryRow = {
  total: 0,
  queued: 0,
  running: 0,
  succeeded: 0,
  succeededWithWarnings: 0,
  pendingReview: 0,
  documentRejected: 0,
  failed: 0,
  cancelled: 0,
  latencySamples: 0,
  p50Ms: null,
  p95Ms: null,
  p99Ms: null,
  maxMs: null,
  avgWaitMs: null,
  maxWaitMs: null,
  oldestQueuedAt: null,
  lastRunAt: null,
};

/**
 * Reparto por estado, **omitiendo los que no ocurrieron**.
 *
 * Publicar los seis siempre obligaría a quien pinte una barra a filtrar ceros,
 * y quien no lo hiciera enseñaría cuatro segmentos vacíos como si significaran
 * algo.
 */
function statusMix(summary: Summary): WorkerStatusCountDto[] {
  const counts: Array<[WorkerRunStatus, number]> = [
    [WorkerRunStatus.SUCCEEDED, summary.succeeded],
    [WorkerRunStatus.SUCCEEDED_WITH_WARNINGS, summary.succeededWithWarnings],
    [WorkerRunStatus.FAILED, summary.failed],
    [WorkerRunStatus.CANCELLED, summary.cancelled],
    [WorkerRunStatus.RUNNING, summary.running],
    [WorkerRunStatus.QUEUED, summary.queued],
    /*
     * Los dos desenlaces nuevos entran en el reparto, y esto no es cosmético.
     * Sin ellos, un worker que derive el 40 % de lo que recibe a revisión humana
     * publicaba un 100 % de acierto: los casos derivados no estaban en ningún
     * contador, así que el panel enseñaba verde sobre una cola creciendo. La
     * tasa de acierto sigue midiendo lo mismo —procesado frente a fallado— pero
     * ahora el reparto delata el hueco.
     */
    [WorkerRunStatus.PENDING_REVIEW, summary.pendingReview],
    [WorkerRunStatus.PDF_INVALID, summary.documentRejected],
  ];
  return counts
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
}
