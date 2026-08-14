/**
 * Ejecutor de la consola: la barrera que pregunta a la base en vez de al texto.
 *
 * Toda consulta pasa por aquí en dos tiempos, igual que en BigQuery:
 *
 *  1. **Se planifica** (`EXPLAIN (FORMAT JSON)`). De ahí salen dos cosas distintas y las
 *     dos importan: la ESTIMACIÓN que se le enseña a quien escribe antes de pulsar
 *     «Ejecutar», y la comprobación de que toda relación que el plan va a recorrer
 *     pertenece a un dataset publicado. Ésta es la barrera que no se puede engañar con
 *     sintaxis, porque no lee sintaxis: lee el plan que el motor pensó ejecutar.
 *  2. **Se ejecuta**, envuelta en un `LIMIT` y dentro de una transacción marcada de sólo
 *     lectura, con `search_path` acotado a los cinco datasets y con reloj.
 *
 * Por qué se inyecta `PrismaReadService` y no `ReadPathService`, que es lo que pide la
 * convención del repositorio: `ReadPathService` reintenta contra el PRIMARIO cuando la
 * conexión de lectura no está disponible. Para una consulta del ORM eso es disponibilidad
 * bien entendida; para SQL escrito por una persona sería mandarlo a una conexión con
 * privilegio de escritura justo el día en que la réplica falla. La consola prefiere caerse
 * a degradar en silencio hacia una conexión con más permisos de los que necesita.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaReadService } from '../../../common/prisma/prisma-read.service';
import { DATASET_NAMES } from '../catalog/dataset-catalog';
import { serializeRows, type SerializedRows } from './row-serializer';

/** Funciones que pueden aparecer como origen de filas en un plan. Espeja la guardia. */
const ALLOWED_FUNCTION_SCANS = new Set([
  'generate_series',
  'unnest',
  'jsonb_array_elements',
  'json_array_elements',
]);

export interface QueryEstimate {
  /** Filas que el planificador espera. Es una ESTIMACIÓN, y la vista lo dice así. */
  readonly estimatedRows: number;
  /** Bytes estimados = filas × ancho medio de fila que calcula el planificador. */
  readonly estimatedBytes: number;
  /** Coste del plan en las unidades de PostgreSQL. Sirve para comparar, no para prometer. */
  readonly planCost: number;
  /** Relaciones que el plan recorre de verdad, no las que el texto nombra. */
  readonly scannedRelations: readonly string[];
}

export interface QueryOutcome extends SerializedRows {
  readonly estimate: QueryEstimate;
  readonly durationMs: number;
  /** Se alcanzó el tope de filas y hay más resultado del que se devuelve. */
  readonly truncated: boolean;
}

export class SqlConsoleQueryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'SqlConsoleQueryError';
  }
}

interface PlanNode {
  readonly 'Node Type'?: string;
  readonly Schema?: string;
  readonly 'Relation Name'?: string;
  readonly 'Function Name'?: string;
  readonly 'Plan Rows'?: number;
  readonly 'Plan Width'?: number;
  readonly 'Total Cost'?: number;
  readonly Plans?: readonly PlanNode[];
  readonly 'CTE Name'?: string;
}

@Injectable()
export class QueryExecutorService {
  private readonly logger = new Logger(QueryExecutorService.name);
  private readonly maxRows: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly readClient: PrismaReadService,
    config: ConfigService,
  ) {
    // 10.000 filas es lo que una rejilla puede pintar sin volverse inútil, y lo que cabe en
    // una respuesta sin convertir la consola en un canal de extracción masiva. Quien
    // necesite más está pidiendo una exportación, que es otra conversación y otro permiso.
    this.maxRows = config.get<number>('SQL_CONSOLE_MAX_ROWS') ?? 10_000;
    // Por debajo del techo global de petición del motor (`REQUEST_TIMEOUT_MS`), a propósito:
    // si la consulta agota el reloj queremos que muera con un error de la consola —que se
    // explica— y no que el motor corte la petición entera sin decir qué pasó.
    this.timeoutMs = config.get<number>('SQL_CONSOLE_TIMEOUT_MS') ?? 12_000;
  }

  get limits(): { maxRows: number; timeoutMs: number } {
    return { maxRows: this.maxRows, timeoutMs: this.timeoutMs };
  }

  /** Sólo planifica. Es el «dry run»: dice qué costaría sin llegar a leer una fila. */
  async estimate(sql: string): Promise<QueryEstimate> {
    return this.withSession(async (tx) => this.explain(tx, sql));
  }

  /** Planifica, verifica el plan y ejecuta. */
  async execute(sql: string): Promise<QueryOutcome> {
    return this.withSession(async (tx) => {
      const estimate = await this.explain(tx, sql);
      const startedAt = Date.now();
      // Se pide UNA fila más que el tope para poder distinguir «cabía justo» de «hay más».
      // Sin ese +1, un resultado de exactamente 10.000 filas se presenta como completo y no
      // hay forma de saber que se quedó algo fuera.
      const rows = await this.run(tx, this.wrap(sql, this.maxRows + 1));
      const durationMs = Date.now() - startedAt;
      const truncated = rows.length > this.maxRows;
      return {
        ...serializeRows(truncated ? rows.slice(0, this.maxRows) : rows),
        estimate,
        durationMs,
        truncated,
      };
    });
  }

  /**
   * Envuelve la consulta para imponer el tope de filas sin tocar lo que el analista escribió.
   *
   * Se envuelve en vez de añadir un `LIMIT` al final porque añadirlo cambiaría el
   * significado de una consulta que ya lo lleve —`… LIMIT 5` seguido de `LIMIT 10000` no es
   * un error de sintaxis, es otra consulta— y porque tampoco vale con `UNION`, donde el
   * `LIMIT` se aplicaría sólo a la última rama.
   */
  private wrap(sql: string, limit: number): string {
    const body = sql.trim().replace(/;\s*$/, '');
    return `SELECT * FROM (\n${body}\n) AS atlas_resultado LIMIT ${limit}`;
  }

  /**
   * Abre la transacción en la que puede correr SQL ajeno, y la deja como debe estar.
   *
   * Los cuatro `set_config(..., true)` son LOCALES a la transacción: al cerrarla la conexión
   * vuelve al pool exactamente como estaba. Hacerlo con `SET` a secas dejaría el
   * `search_path` de la consola pegado a esa conexión, y la siguiente petición del motor
   * —cualquiera, de cualquier módulo— la heredaría. Sería un fallo intermitente que aparece
   * y desaparece según qué conexión toque, que es el peor de todos los fallos.
   */
  private async withSession<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await this.readClient.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT set_config('transaction_read_only', 'on', true)`;
          await tx.$queryRaw`SELECT set_config('search_path', ${DATASET_NAMES.join(',')}, true)`;
          await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(this.timeoutMs)}, true)`;
          // Sin esto, una consulta que espere un candado se lo queda hasta el techo de la
          // sentencia; con esto falla enseguida y con un error propio.
          await tx.$queryRaw`SELECT set_config('lock_timeout', '2000', true)`;
          return work(tx);
        },
        // El tope de la transacción va por encima del de la sentencia para que el error que
        // llegue sea el de la consulta, con su mensaje, y no un abort genérico de Prisma.
        { timeout: this.timeoutMs + 3_000, maxWait: 5_000 },
      );
    } catch (error) {
      throw this.translate(error);
    }
  }

  private async run(
    tx: Prisma.TransactionClient,
    sql: string,
  ): Promise<Record<string, unknown>[]> {
    return (await tx.$queryRawUnsafe(sql)) as Record<string, unknown>[];
  }

  private async explain(tx: Prisma.TransactionClient, sql: string): Promise<QueryEstimate> {
    const wrapped = this.wrap(sql, this.maxRows + 1);
    const explained = (await this.run(tx, `EXPLAIN (FORMAT JSON) ${wrapped}`)) as unknown as {
      'QUERY PLAN': PlanNode[] | string;
    }[];
    const raw = explained[0]?.['QUERY PLAN'];
    const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { Plan: PlanNode }[];
    const root = parsed?.[0]?.Plan;
    if (!root) {
      throw new SqlConsoleQueryError(
        'SQL_PLAN_UNAVAILABLE',
        'No se pudo planificar la consulta.',
      );
    }

    const scanned = new Set<string>();
    this.walkPlan(root, scanned);

    const rows = Math.max(0, Math.round(root['Plan Rows'] ?? 0));
    const width = Math.max(0, Math.round(root['Plan Width'] ?? 0));
    return {
      estimatedRows: rows,
      estimatedBytes: rows * width,
      planCost: Math.round((root['Total Cost'] ?? 0) * 100) / 100,
      scannedRelations: [...scanned].sort(),
    };
  }

  /**
   * Recorre el plan y exige que todo lo que se lee esté publicado.
   *
   * Esto es lo que atrapa lo que la guardia léxica no puede ver. El caso concreto que
   * justifica el código: una vista del catálogo que alguien encadenara sobre una tabla no
   * publicada seguiría llamándose `decisiones.algo` en el texto, y aquí aparecería con el
   * esquema real de la tabla que de verdad recorre.
   */
  private walkPlan(node: PlanNode, scanned: Set<string>): void {
    const relation = node['Relation Name'];
    if (relation) {
      const schema = node.Schema ?? '';
      if (!DATASET_NAMES.includes(schema)) {
        throw new SqlConsoleQueryError(
          'SQL_RELATION_NOT_PUBLISHED',
          `La consulta intenta leer \`${schema || '?'}.${relation}\`, que no forma parte de ` +
            'los datasets publicados en la consola.',
        );
      }
      scanned.add(`${schema}.${relation}`);
    }

    const fn = node['Function Name'];
    if (fn && !ALLOWED_FUNCTION_SCANS.has(fn)) {
      throw new SqlConsoleQueryError(
        'SQL_FUNCTION_NOT_PUBLISHED',
        `La función \`${fn}()\` no se admite como origen de filas en la consola.`,
      );
    }

    for (const child of node.Plans ?? []) this.walkPlan(child, scanned);
  }

  /**
   * Convierte el error de PostgreSQL en algo que se pueda leer sin abrir los registros.
   *
   * El detalle crudo NO se devuelve tal cual salvo en los errores de sintaxis, donde es
   * justamente lo útil. Un `permission denied for table decision_execution` confirmaría al
   * otro lado el nombre de una tabla que la consola no publica; un `division by zero`
   * puede citar el valor que la provocó.
   */
  private translate(error: unknown): SqlConsoleQueryError {
    if (error instanceof SqlConsoleQueryError) return error;
    const known = error as { code?: string; meta?: { code?: string; message?: string } };
    const pgCode = known.meta?.code ?? known.code ?? '';
    const message = known.meta?.message ?? (error instanceof Error ? error.message : '');

    // 42601 sintaxis · 42703 columna inexistente · 42P01 relación inexistente · 42883 función
    if (['42601', '42703', '42P01', '42883', '42804', '42P18'].includes(pgCode)) {
      return new SqlConsoleQueryError('SQL_INVALID', 'La consulta no es válida.', message);
    }
    if (pgCode === '57014' || /statement timeout|canceling statement/i.test(message)) {
      return new SqlConsoleQueryError(
        'SQL_TIMEOUT',
        `La consulta superó el límite de ${Math.round(this.timeoutMs / 1000)} segundos. ` +
          'Acota el rango de fechas o agrega antes de cruzar.',
      );
    }
    if (pgCode === '42501' || /permission denied/i.test(message)) {
      return new SqlConsoleQueryError(
        'SQL_FORBIDDEN',
        'La consulta intenta alcanzar datos que la consola no publica.',
      );
    }
    if (/ATLAS_SQL_TENANT_NOT_SET/.test(message)) {
      return new SqlConsoleQueryError(
        'SQL_TENANT_MISSING',
        'La sesión no tiene organización asociada; vuelve a entrar al portal.',
      );
    }
    this.logger.error(`Unexpected SQL console failure (${pgCode || 'sin código'})`, error);
    return new SqlConsoleQueryError('SQL_FAILED', 'La consulta no se pudo completar.');
  }
}
