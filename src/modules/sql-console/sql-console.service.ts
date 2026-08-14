/**
 * Orquesta lo que pasa entre que alguien pulsa «Ejecutar» y ve una tabla.
 *
 * El orden no es negociable y por eso vive en un solo sitio: guardia → plan → ejecución →
 * bitácora. Con la bitácora al final se perdería justo lo que hay que registrar —los
 * intentos RECHAZADOS—, que son los que dicen si alguien está tanteando la superficie. Por
 * eso se escribe en los cuatro desenlaces, incluido el que no llegó a tocar la base.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { SQL_CONSOLE_CATALOG } from './catalog/dataset-catalog';
import { QueryExecutorService, SqlConsoleQueryError } from './execution/query-executor.service';
import { guardSql, MAX_SQL_BYTES, type GuardViolation } from './guard/sql-guard';
import type {
  QueryHistoryPageDto,
  QueryResultDto,
  QueryValidationDto,
  SqlCatalogDto,
} from './sql-console.response.dto';

type Outcome = 'VALIDATED' | 'SUCCEEDED' | 'REJECTED' | 'FAILED';

interface LogInput {
  readonly outcome: Outcome;
  readonly statement: string;
  readonly relations?: readonly string[];
  readonly errorCode?: string;
  readonly rowCount?: number;
  readonly durationMs?: number;
  readonly estimatedRows?: number;
  readonly truncated?: boolean;
}

@Injectable()
export class SqlConsoleService {
  private readonly logger = new Logger(SqlConsoleService.name);

  constructor(
    private readonly executor: QueryExecutorService,
    private readonly prisma: PrismaService,
  ) {}

  catalog(): SqlCatalogDto {
    const { maxRows, timeoutMs } = this.executor.limits;
    return {
      datasets: SQL_CONSOLE_CATALOG.map((dataset) => ({
        name: dataset.name,
        description: dataset.description,
        tables: dataset.tables.map((table) => ({
          name: table.name,
          description: table.description,
          grain: table.grain,
          columns: table.columns.map((column) => ({ ...column })),
        })),
      })),
      limits: { maxRows, timeoutMs, maxStatementBytes: MAX_SQL_BYTES },
    };
  }

  /**
   * El «dry run»: planifica sin leer una sola fila.
   *
   * No registra un rechazo de la guardia como intento fallido de la misma forma que una
   * ejecución: aquí se escribe mientras se teclea, y contar cada error de sintaxis como un
   * intento llenaría la bitácora de ruido hasta hacerla inútil para lo que existe. Se
   * registra sólo cuando la consulta era VÁLIDA y se llegó a planificar, que es cuando el
   * motor de verdad miró el catálogo.
   */
  async validate(
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    statement: string,
  ): Promise<QueryValidationDto> {
    const guard = guardSql(statement);
    if (!guard.ok) return { valid: false, violations: [...guard.violations] };

    try {
      const estimate = await this.executor.estimate(statement);
      /*
       * Se informan los nombres PUBLICADOS, no los que aparecen en el plan.
       *
       * El planificador expande las vistas, así que su plan habla de
       * `public.decision_execution`; enseñar eso en «Detalles de ejecución» rompería
       * justamente lo que el catálogo promete —que los nombres son un contrato y no un
       * espejo del esquema— y enseñaría la estructura interna a quien no la necesita. El
       * plan sigue mirándose, pero para bloquear, no para contarlo.
       */
      const relations = [...guard.relations];
      await this.log(tenantId, principal, {
        outcome: 'VALIDATED',
        statement,
        relations,
        estimatedRows: estimate.estimatedRows,
      });
      return {
        valid: true,
        violations: [],
        estimate: { ...estimate, scannedRelations: relations },
      };
    } catch (error) {
      return { valid: false, violations: [this.asViolation(error)] };
    }
  }

  async run(
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    statement: string,
  ): Promise<QueryResultDto> {
    const guard = guardSql(statement);
    if (!guard.ok) {
      await this.log(tenantId, principal, {
        outcome: 'REJECTED',
        statement,
        errorCode: guard.violations[0]?.code,
      });
      throw new SqlConsoleQueryError(
        guard.violations[0]?.code ?? 'SQL_REJECTED',
        guard.violations[0]?.message ?? 'La consulta fue rechazada.',
      );
    }

    try {
      const outcome = await this.executor.execute(statement);
      // Los nombres publicados, no los del plan. El porqué está en `validate`.
      const relations = [...guard.relations];
      await this.log(tenantId, principal, {
        outcome: 'SUCCEEDED',
        statement,
        relations,
        rowCount: outcome.rows.length,
        durationMs: outcome.durationMs,
        estimatedRows: outcome.estimate.estimatedRows,
        truncated: outcome.truncated,
      });
      return {
        columns: outcome.columns.map((column) => ({ ...column })),
        rows: outcome.rows.map((row) => [...row]),
        rowCount: outcome.rows.length,
        durationMs: outcome.durationMs,
        truncated: outcome.truncated,
        estimate: { ...outcome.estimate, scannedRelations: relations },
      };
    } catch (error) {
      const violation = this.asViolation(error);
      await this.log(tenantId, principal, {
        outcome: 'FAILED',
        statement,
        errorCode: violation.code,
      });
      throw error;
    }
  }

  /** El historial es SIEMPRE el de quien pregunta. No hay forma de pedir el de otro. */
  async history(
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    limit = 25,
  ): Promise<QueryHistoryPageDto> {
    const rows = await this.prisma.sqlConsoleQueryLog.findMany({
      where: { tenantId, actorId: principal.id },
      orderBy: { executedAt: 'desc' },
      take: limit,
    });
    return {
      entries: rows.map((row) => ({
        id: row.id.toString(),
        statement: row.statement,
        outcome: row.outcome,
        errorCode: row.errorCode,
        rowCount: row.rowCount,
        durationMs: row.durationMs,
        truncated: row.truncated,
        relations: row.relations,
        executedAt: row.executedAt.toISOString(),
      })),
    };
  }

  private asViolation(error: unknown): GuardViolation {
    if (error instanceof SqlConsoleQueryError) {
      return {
        code: error.code,
        message: error.detail ? `${error.message} ${error.detail}` : error.message,
      };
    }
    return { code: 'SQL_FAILED', message: 'La consulta no se pudo completar.' };
  }

  /**
   * Escribe la bitácora sin poder tumbar la consulta.
   *
   * Si el registro falla, la consulta que ya se ejecutó no se deshace ni se le oculta el
   * resultado a quien la pidió: sería castigar a quien no hizo nada mal por un fallo de la
   * infraestructura de auditoría. Lo que sí pasa es que queda un error de nivel `error` en
   * el registro del servicio, que es donde se ve.
   */
  private async log(
    tenantId: bigint,
    principal: AuthenticatedPrincipal,
    input: LogInput,
  ): Promise<void> {
    try {
      await this.prisma.sqlConsoleQueryLog.create({
        data: {
          tenantId,
          actorId: principal.id,
          requestId: principal.requestId,
          statement: input.statement,
          relations: [...(input.relations ?? [])],
          outcome: input.outcome,
          errorCode: input.errorCode ?? null,
          rowCount: input.rowCount ?? null,
          durationMs: input.durationMs ?? null,
          estimatedRows: input.estimatedRows === undefined ? null : BigInt(input.estimatedRows),
          truncated: input.truncated ?? false,
        },
      });
    } catch (error) {
      this.logger.error('No se pudo registrar la consulta en la bitácora de la consola', error);
    }
  }
}
