/**
 * Cosechas: ¿la política de este mes es mejor que la del mes pasado?
 *
 * Es la pregunta por la que existe todo el circuito, y la única que no se puede responder con
 * una foto. Una tasa de malos global mezcla créditos de marzo con dos meses de vida y de enero
 * con cuatro, y como la mora madura con el tiempo, la mezcla dice más del reparto de edades de
 * la cartera que de la calidad de la política. La matriz separa las dos dimensiones: cosecha
 * (cuándo se decidió) contra madurez (cuántos días lleva).
 *
 * Se agrupa por CRÉDITO y no por decisión. Un préstamo recibe muchas decisiones a lo largo de
 * su vida —originación, aumento, refinanciación— y contando decisiones, quien más veces fue
 * evaluado pesa más en la tasa, que es justo al revés de lo que se quiere medir.
 */
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { parseBigIntId } from '../../common/http/id';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { PendingWindowsQueryDto, VintageQueryDto } from './outcome-ingestion.dto';

/** Tope de la cola de pendientes: es trabajo para una persona, no un volcado. */
const MAX_PENDING = 200;

interface VintageRow {
  cohort: Date;
  window_days: number;
  decisions: bigint;
  observed: bigint;
  bad: bigint;
  inferred: bigint;
  bad_amount: Prisma.Decimal | null;
}

interface PendingRow {
  id: bigint;
  execution_id: bigint;
  window_days: number;
  due_at: Date;
  external_reference: string | null;
  artifact_code: string;
  executed_at: Date;
}

@Injectable()
export class VintageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Matriz cosecha × madurez.
   *
   * `observed` viaja junto a `badRate` a propósito: una tasa del 0 % sobre cuatro créditos
   * observados y otra sobre cuatrocientos se pintan igual si sólo se manda el porcentaje, y la
   * primera no significa nada. La pantalla necesita el denominador para poder atenuarla.
   */
  async vintage(tenantId: bigint, query: VintageQueryDto) {
    const artifactVersionId = query.artifactVersionId
      ? parseBigIntId(query.artifactVersionId, 'artifactVersionId')
      : null;
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 365 * 24 * 3_600_000);

    const rows = await this.prisma.$queryRaw<VintageRow[]>`
      SELECT
        date_trunc('month', e."executed_at")                                    AS cohort,
        w."window_days"                                                         AS window_days,
        COUNT(DISTINCT w."facility_id")::bigint                                 AS decisions,
        COUNT(DISTINCT w."facility_id") FILTER (WHERE o."id" IS NOT NULL)::bigint AS observed,
        COUNT(DISTINCT w."facility_id") FILTER (
          WHERE o."label" IN ('BAD', 'REJECTED_CONFIRMED_BAD')
        )::bigint                                                               AS bad,
        COUNT(DISTINCT w."facility_id") FILTER (
          WHERE o."inference_method" IS NOT NULL
        )::bigint                                                               AS inferred,
        SUM(o."amount") FILTER (WHERE o."label" = 'BAD')                        AS bad_amount
      FROM "outcome_window_schedule" w
      JOIN "decision_execution" e ON e."id" = w."execution_id"
      LEFT JOIN "decision_outcome_observation" o
        ON o."execution_id" = w."execution_id" AND o."window_days" = w."window_days"
      WHERE w."tenant_id" = ${tenantId}
        AND w."facility_id" IS NOT NULL
        AND e."executed_at" >= ${from}
        AND e."executed_at" <= ${to}
        AND (${artifactVersionId}::bigint IS NULL OR e."artifact_version_id" = ${artifactVersionId}::bigint)
      GROUP BY 1, 2
      ORDER BY 1, 2
    `;

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      cells: rows.map((row) => {
        const observed = Number(row.observed);
        const bad = Number(row.bad);
        return {
          cohort: row.cohort.toISOString().slice(0, 7),
          windowDays: row.window_days,
          facilities: Number(row.decisions),
          observed,
          bad,
          inferred: Number(row.inferred),
          /** Nulo sin observaciones: un 0 % sobre nada no es una cosecha buena, es una vacía. */
          badRate: observed > 0 ? Number((bad / observed).toFixed(6)) : null,
          badAmount: row.bad_amount ? Number(row.bad_amount) : 0,
        };
      }),
    };
  }

  /**
   * Ventanas vencidas que nadie observó, la más vieja primero.
   *
   * Esta lista es el producto principal de todo el módulo: convierte «faltan desenlaces» —una
   * afirmación con la que no se puede hacer nada— en una cola de trabajo con nombres concretos.
   */
  async pending(tenantId: bigint, query: PendingWindowsQueryDto) {
    const limit = Math.min(query.limit ?? 50, MAX_PENDING);
    const rows = await this.prisma.$queryRaw<PendingRow[]>`
      SELECT
        w."id"                  AS id,
        w."execution_id"        AS execution_id,
        w."window_days"         AS window_days,
        w."due_at"              AS due_at,
        f."external_reference"  AS external_reference,
        a."artifact_code"       AS artifact_code,
        e."executed_at"         AS executed_at
      FROM "outcome_window_schedule" w
      JOIN "decision_execution" e ON e."id" = w."execution_id"
      JOIN "decision_artifact_version" v ON v."id" = e."artifact_version_id"
      JOIN "decision_artifact" a ON a."id" = v."artifact_id"
      LEFT JOIN "credit_facility" f ON f."id" = w."facility_id"
      WHERE w."tenant_id" = ${tenantId}
        AND w."observed_at" IS NULL
        AND w."due_at" <= now()
      ORDER BY w."due_at" ASC
      LIMIT ${limit}
    `;

    return {
      limit,
      items: rows.map((row) => ({
        windowId: row.id.toString(),
        executionId: row.execution_id.toString(),
        windowDays: row.window_days,
        dueAt: row.due_at.toISOString(),
        decidedAt: row.executed_at.toISOString(),
        overdueDays: Math.floor((Date.now() - row.due_at.getTime()) / 86_400_000),
        externalReference: row.external_reference,
        artifactCode: row.artifact_code,
      })),
    };
  }
}
