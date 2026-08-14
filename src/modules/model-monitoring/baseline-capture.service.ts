/**
 * Congela la población de referencia en el momento de PROMOVER.
 *
 * La estabilidad poblacional compara la población de hoy contra una de referencia, y la elección
 * de esa referencia decide si el índice sirve para algo. Tomarla «del mes pasado» —lo natural, y
 * lo que hace casi todo el mundo— hace que la deriva LENTA no se detecte nunca: la referencia
 * deriva junto con la población, el índice se queda plano, y el modelo se aleja del mundo sin que
 * nada se encienda.
 *
 * Se congela al promover porque la población contra la que se validó el modelo es la única
 * referencia que significa algo: «¿le siguen llegando los solicitantes para los que esto se
 * comprobó?».
 *
 * Cómo se elige la muestra, y por qué puede quedar vacía: se leen las ejecuciones de la versión
 * ANTERIOR del mismo artefacto en ese ambiente. Una versión que se promueve por primera vez no
 * tiene predecesora y no deja línea base — es correcto y hay que poder verlo: sin población previa
 * no hay referencia posible, y fabricar una con las primeras ejecuciones de la versión nueva sería
 * medir la deriva contra sí misma.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { bucketOfValue } from './monitoring-analytics';

/** Techo de la muestra. Más filas no mejoran un histograma de diez cubos. */
const MAX_SAMPLE = 20_000;
/** Por debajo de esto la referencia sería ruido con aspecto de distribución. */
const MIN_SAMPLE = 100;

interface SnapshotRow {
  input: Prisma.JsonValue | null;
}

@Injectable()
export class BaselineCaptureService {
  private readonly logger = new Logger(BaselineCaptureService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Captura la línea base de una versión recién promovida.
   *
   * Best-effort a propósito: un fallo aquí NO puede tumbar un despliegue. La promoción es la
   * operación crítica; la línea base es evidencia para vigilar después, y perderla se arregla
   * recapturándola. Al revés —un despliegue abortado porque el histograma falló— sería un
   * intercambio absurdo.
   */
  async capture(
    tenantId: bigint,
    artifactVersionId: bigint,
    artifactCode: string,
    environmentId: bigint,
    capturedBy: string,
  ): Promise<number> {
    try {
      const rows = await this.previousPopulation(tenantId, artifactCode, environmentId, artifactVersionId);
      if (rows.length < MIN_SAMPLE) {
        this.logger.log(
          `Sin línea base para la versión ${artifactVersionId}: ${rows.length} ejecuciones previas, ` +
            `por debajo del mínimo de ${MIN_SAMPLE}.`,
        );
        return 0;
      }

      const histograms = this.histograms(rows);
      const entries = [...histograms.entries()];
      if (!entries.length) return 0;

      await this.prisma.monitoringBaseline.createMany({
        data: entries.map(([variableCode, buckets]) => ({
          tenantId,
          artifactVersionId,
          variableCode,
          bucketsJson: buckets as Prisma.InputJsonValue,
          sampleSize: rows.length,
          capturedBy,
        })),
        // Recapturar no debe pisar la referencia original: si ya hay línea base, esa es LA
        // población contra la que se validó, y sustituirla por otra posterior es exactamente el
        // fallo de la referencia móvil que esto viene a evitar.
        skipDuplicates: true,
      });
      this.logger.log(
        `Línea base capturada para la versión ${artifactVersionId}: ${entries.length} variables ` +
          `sobre ${rows.length} ejecuciones.`,
      );
      return entries.length;
    } catch (error) {
      this.logger.error(
        `No se pudo capturar la línea base de la versión ${artifactVersionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 0;
    }
  }

  /** Las ejecuciones de las versiones ANTERIORES del mismo artefacto en ese ambiente. */
  private async previousPopulation(
    tenantId: bigint,
    artifactCode: string,
    environmentId: bigint,
    artifactVersionId: bigint,
  ): Promise<SnapshotRow[]> {
    return this.prisma.$queryRaw<SnapshotRow[]>`
      SELECT e."input_snapshot_json" AS input
      FROM "decision_execution" e
      JOIN "decision_artifact_version" v ON v."id" = e."artifact_version_id"
      JOIN "decision_artifact" a ON a."id" = v."artifact_id"
      WHERE e."tenant_id" = ${tenantId}
        AND a."artifact_code" = ${artifactCode}
        AND e."environment_id" = ${environmentId}
        AND e."artifact_version_id" <> ${artifactVersionId}
      ORDER BY e."executed_at" DESC
      LIMIT ${MAX_SAMPLE}
    `;
  }

  /**
   * Un histograma de frecuencias relativas por variable.
   *
   * Se guarda el HISTOGRAMA y no la muestra: para el índice basta, y conservar valores sería
   * retener datos personales sin necesidad —una línea base es un artefacto que vive años—.
   */
  private histograms(rows: SnapshotRow[]): Map<string, Record<string, number>> {
    const counts = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const snapshot = row.input;
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) continue;
      for (const [code, value] of Object.entries(snapshot as Record<string, unknown>)) {
        const bucket = bucketOfValue(value);
        if (bucket === null) continue;
        if (!counts.has(code)) counts.set(code, new Map());
        const forCode = counts.get(code) as Map<string, number>;
        forCode.set(bucket, (forCode.get(bucket) ?? 0) + 1);
      }
    }

    const histograms = new Map<string, Record<string, number>>();
    for (const [code, forCode] of counts) {
      const total = [...forCode.values()].reduce((sum, count) => sum + count, 0);
      if (total === 0) continue;
      histograms.set(
        code,
        Object.fromEntries([...forCode].map(([bucket, count]) => [bucket, Number((count / total).toFixed(6))])),
      );
    }
    return histograms;
  }
}
