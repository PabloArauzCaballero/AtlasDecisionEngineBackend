/**
 * ¿Está VIVO el circuito de la decisión?
 *
 * Las otras tres preguntas del monitoreo (¿acierta?, ¿le llegan los mismos?, ¿trata igual?) dan
 * por hecho que hay datos con los que responderlas. Ésta comprueba justamente eso, y es la que
 * faltaba: sin denominador, «cero desenlaces malos» y «nadie cargó los desenlaces» se leen
 * igual, y un tablero en verde puede estar describiendo un sistema de medición apagado.
 *
 * Dos razones, dos denominadores:
 *
 *  - **Cobertura de sujeto** — de las decisiones que DEBERÍAN llevar solicitante, cuántas lo
 *    llevan. Las que declaran `NOT_APPLICABLE` salen del denominador en vez de contarse como
 *    fallo: son reglas de sistema, y meterlas dentro haría que la cifra no se pudiera alcanzar
 *    nunca y por tanto nadie la mirase.
 *  - **Cobertura de desenlace** — de las ventanas de observación ya vencidas, cuántas se
 *    cerraron. Vencidas, no todas: una ventana de 360 días abierta ayer no es una deuda.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MetricsService } from '../../common/observability/metrics.service';
import type { CoverageQueryDto } from './model-monitoring.dto';

/** Techo de la serie diaria. Medio año de puntos es todo lo que una gráfica puede decir. */
const MAX_SERIES_DAYS = 180;

interface CoverageTotalsRow {
  executions: bigint;
  with_subject: bigint;
  not_applicable: bigint;
}

interface WindowTotalsRow {
  due: bigint;
  observed: bigint;
  inferred: bigint;
}

interface DailyRow {
  day: Date;
  executions: bigint;
  with_subject: bigint;
}

@Injectable()
export class DecisionCoverageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  async coverage(tenantId: bigint, query: CoverageQueryDto) {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : defaultFrom(to);

    const [totals] = await this.prisma.$queryRaw<CoverageTotalsRow[]>`
      SELECT
        COUNT(*)::bigint                                                        AS executions,
        COUNT(*) FILTER (WHERE "subject_id" IS NOT NULL)::bigint                AS with_subject,
        COUNT(*) FILTER (WHERE "subject_absence_reason" = 'NOT_APPLICABLE')::bigint
                                                                                AS not_applicable
      FROM "decision_execution"
      WHERE "tenant_id" = ${tenantId}
        AND "executed_at" >= ${from}
        AND "executed_at" <= ${to}
    `;

    const [windows] = await this.prisma.$queryRaw<WindowTotalsRow[]>`
      SELECT
        COUNT(*)::bigint                                             AS due,
        COUNT(*) FILTER (WHERE w."observed_at" IS NOT NULL)::bigint  AS observed,
        COUNT(*) FILTER (WHERE o."inference_method" IS NOT NULL)::bigint AS inferred
      FROM "outcome_window_schedule" w
      LEFT JOIN "decision_outcome_observation" o
        ON o."execution_id" = w."execution_id" AND o."window_days" = w."window_days"
      WHERE w."tenant_id" = ${tenantId}
        AND w."due_at" <= ${to}
    `;

    const daily = await this.prisma.$queryRaw<DailyRow[]>`
      SELECT
        date_trunc('day', "executed_at")                          AS day,
        COUNT(*)::bigint                                          AS executions,
        COUNT(*) FILTER (WHERE "subject_id" IS NOT NULL)::bigint  AS with_subject
      FROM "decision_execution"
      WHERE "tenant_id" = ${tenantId}
        AND "executed_at" >= ${from}
        AND "executed_at" <= ${to}
      GROUP BY 1
      ORDER BY 1
      LIMIT ${MAX_SERIES_DAYS}
    `;

    const executions = Number(totals?.executions ?? 0);
    const withSubject = Number(totals?.with_subject ?? 0);
    const notApplicable = Number(totals?.not_applicable ?? 0);
    const eligible = Math.max(0, executions - notApplicable);
    const dueWindows = Number(windows?.due ?? 0);
    const observedWindows = Number(windows?.observed ?? 0);

    const subjectCoverageRatio = ratio(withSubject, eligible);
    const outcomeCoverageRatio = ratio(observedWindows, dueWindows);
    if (subjectCoverageRatio !== null) this.metrics.setSubjectCoverage(subjectCoverageRatio);
    if (outcomeCoverageRatio !== null) this.metrics.setOutcomeCoverage(outcomeCoverageRatio);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      subject: {
        executions,
        /** Decisiones que declaran no tener sujeto. Fuera del denominador, no restadas del acierto. */
        notApplicable,
        eligible,
        withSubject,
        missing: Math.max(0, eligible - withSubject),
        /** Nulo, no cero, cuando no hubo decisiones: un 0 % sobre nada es una alarma falsa. */
        coverageRatio: subjectCoverageRatio,
      },
      outcome: {
        dueWindows,
        observedWindows,
        overdueWindows: Math.max(0, dueWindows - observedWindows),
        /** Cuántas de las observadas se INFIRIERON. Mezclarlas con las observadas calibra el
         * modelo contra la población que ya aprobó y lo hace parecer perfecto. */
        inferredWindows: Number(windows?.inferred ?? 0),
        coverageRatio: outcomeCoverageRatio,
      },
      daily: daily.map((row) => ({
        day: row.day.toISOString().slice(0, 10),
        executions: Number(row.executions),
        withSubject: Number(row.with_subject),
      })),
    };
  }
}

/** Sin numerador posible no hay ratio. Devolver 0 pintaría de rojo un sistema que no decidió. */
function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(6));
}

/** Treinta días hacia atrás: el horizonte con el que se mira si el circuito está vivo hoy. */
function defaultFrom(to: Date): Date {
  return new Date(to.getTime() - 30 * 24 * 60 * 60 * 1_000);
}
