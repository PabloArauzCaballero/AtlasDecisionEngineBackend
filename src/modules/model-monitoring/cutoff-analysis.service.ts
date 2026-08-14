/**
 * Las dos conversaciones que el negocio quiere tener y no podía.
 *
 *  - **¿Dónde pongo el corte?** Para cada umbral posible, cuánto se aprueba y cuánto se pierde.
 *    Sin esta curva, mover un corte es una discusión de opiniones: quien quiere volumen y quien
 *    quiere calidad tienen razón por separado y ninguno puede enseñar el intercambio.
 *  - **¿La versión nueva es mejor que la vieja?** Comparación entre ramas de tráfico por
 *    DESENLACE OBSERVADO, no por volumen. El champion/challenger ya repartía tráfico desde hacía
 *    tiempo; comparar lo que produce cada rama era lo que faltaba, y sin eso el experimento
 *    reparte pero no concluye.
 *
 * Las dos van con intervalo de confianza. Sin él, la comparación invita a decidir sobre ruido:
 * dos puntos porcentuales de diferencia sobre cuarenta casos no son una diferencia.
 */
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { PrismaService } from '../../common/prisma/prisma.service';

const MAX_ROWS = 20_000;
/** Cortes de la curva. Veinte puntos describen la forma sin volverla ilegible. */
const CUTOFF_STEPS = 20;

interface ScoredRow {
  score: Prisma.Decimal | number | null;
  label: string;
  amount: Prisma.Decimal | null;
}

interface BranchRow {
  deployment_id: bigint;
  artifact_version_id: bigint;
  decisions: bigint;
  observed: bigint;
  bad: bigint;
  approved: bigint;
}

@Injectable()
export class CutoffAnalysisService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Para cada corte posible: qué se aprobaría, qué proporción saldría mal y cuánto se perdería.
   *
   * El corte se aplica sobre el puntaje con la convención «MÁS ALTO = MÁS RIESGO»: se aprueba lo
   * que queda POR DEBAJO. Si el artefacto publica al revés, la curva sale invertida y se ve de
   * inmediato — preferible a una normalización automática que adivine la convención y acierte
   * casi siempre.
   */
  async cutoffCurve(tenantId: bigint, artifactVersionId: string, scoreField: string, windowDays: number) {
    const versionId = parseBigIntId(artifactVersionId, 'artifactVersionId');
    await this.assertVersion(tenantId, versionId);

    const rows = await this.prisma.$queryRaw<ScoredRow[]>`
      SELECT
        (e."output_json" ->> ${scoreField})::numeric AS score,
        o."label"::text                              AS label,
        o."amount"                                   AS amount
      FROM "decision_execution" e
      JOIN "decision_outcome_observation" o
        ON o."execution_id" = e."id" AND o."window_days" = ${windowDays}
      WHERE e."tenant_id" = ${tenantId}
        AND e."artifact_version_id" = ${versionId}
        AND o."inference_method" IS NULL
        AND o."label" IN ('GOOD', 'BAD')
        AND e."output_json" ->> ${scoreField} IS NOT NULL
      LIMIT ${MAX_ROWS}
    `;

    const samples = rows
      .map((row) => ({
        score: Number(row.score),
        bad: row.label === 'BAD',
        loss: row.amount ? Number(row.amount) : 0,
      }))
      .filter((sample) => Number.isFinite(sample.score));

    if (samples.length < 10) {
      return { artifactVersionId, scoreField, windowDays, analyzed: samples.length, points: [] };
    }

    const scores = samples.map((sample) => sample.score).sort((left, right) => left - right);
    const min = scores[0];
    const max = scores[scores.length - 1];
    const points = [];
    for (let step = 1; step <= CUTOFF_STEPS; step += 1) {
      const cutoff = min + ((max - min) * step) / CUTOFF_STEPS;
      const approved = samples.filter((sample) => sample.score <= cutoff);
      const bad = approved.filter((sample) => sample.bad);
      points.push({
        cutoff: Number(cutoff.toFixed(6)),
        approvalRate: Number((approved.length / samples.length).toFixed(6)),
        approved: approved.length,
        badRate: approved.length ? Number((bad.length / approved.length).toFixed(6)) : null,
        expectedLoss: Number(bad.reduce((total, sample) => total + sample.loss, 0).toFixed(2)),
        // Sin él, dos puntos de la curva sostenidos por seis casos parecen tan firmes como uno
        // sostenido por seis mil.
        confidenceHalfWidth: halfWidth(bad.length, approved.length),
      });
    }

    return { artifactVersionId, scoreField, windowDays, analyzed: samples.length, points };
  }

  /**
   * Champion contra challenger, por desenlace real.
   *
   * Compara las ramas de un despliegue con reparto de tráfico. Lo que se enfrenta es la tasa de
   * malos de cada rama sobre sus casos OBSERVADOS, no su volumen: repartir tráfico 90/10 y
   * concluir que el champion «funciona mejor» porque tiene nueve veces más decisiones es el error
   * que esta comparación existe para impedir.
   */
  async compareBranches(tenantId: bigint, deploymentId: string) {
    const id = parseBigIntId(deploymentId, 'deploymentId');
    const rows = await this.prisma.$queryRaw<BranchRow[]>`
      SELECT
        d."id"                                                             AS deployment_id,
        d."artifact_version_id"                                            AS artifact_version_id,
        COUNT(e."id")::bigint                                              AS decisions,
        COUNT(o."id")::bigint                                              AS observed,
        COUNT(*) FILTER (WHERE o."label" = 'BAD')::bigint                  AS bad,
        COUNT(*) FILTER (WHERE e."business_outcome" NOT IN ('DECLINE', 'REJECT', 'FAIL'))::bigint
                                                                           AS approved
      FROM "decision_deployment" d
      JOIN "decision_execution" e ON e."deployment_id" = d."id"
      LEFT JOIN "decision_outcome_observation" o
        ON o."execution_id" = e."id" AND o."inference_method" IS NULL
      WHERE e."tenant_id" = ${tenantId}
        AND (d."id" = ${id} OR d."previous_deployment_id" = ${id} OR d."id" = (
          SELECT "previous_deployment_id" FROM "decision_deployment" WHERE "id" = ${id}
        ))
      GROUP BY 1, 2
      ORDER BY 1
    `;

    return {
      deploymentId,
      branches: rows.map((row) => {
        const observed = Number(row.observed);
        const bad = Number(row.bad);
        return {
          deploymentId: row.deployment_id.toString(),
          artifactVersionId: row.artifact_version_id.toString(),
          decisions: Number(row.decisions),
          observed,
          approvalRate: Number(row.decisions)
            ? Number((Number(row.approved) / Number(row.decisions)).toFixed(6))
            : null,
          /** Nulo sin observaciones: una rama sin desenlaces no ha ganado nada, no ha jugado. */
          badRate: observed ? Number((bad / observed).toFixed(6)) : null,
          confidenceHalfWidth: halfWidth(bad, observed),
        };
      }),
    };
  }

  private async assertVersion(tenantId: bigint, artifactVersionId: bigint): Promise<void> {
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: artifactVersionId, artifact: { tenantId } },
      select: { id: true },
    });
    if (!version) {
      throw new DomainException('VERSION_NOT_FOUND', 'Artifact version not found', HttpStatus.NOT_FOUND);
    }
  }
}

/**
 * Semiancho del intervalo de Wald al 95 %.
 *
 * Es la aproximación de manual y es mala en los extremos —con cero malos da cero, que sugiere
 * certeza donde hay poca información—, así que se devuelve `null` por debajo de treinta casos en
 * vez de publicar un número que engaña. Para una pantalla de comparación es suficiente: lo que
 * tiene que impedir es que alguien lea como diferencia lo que es ruido.
 */
function halfWidth(successes: number, total: number): number | null {
  if (total < 30) return null;
  const proportion = successes / total;
  return Number((1.96 * Math.sqrt((proportion * (1 - proportion)) / total)).toFixed(6));
}
