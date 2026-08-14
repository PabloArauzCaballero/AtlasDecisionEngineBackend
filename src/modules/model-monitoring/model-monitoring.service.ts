import { HttpStatus, Injectable } from '@nestjs/common';
import { ObservedOutcomeLabel, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { MetricsService } from '../../common/observability/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import {
  adverseImpactRatios,
  bucketOfSnapshot,
  isApproval,
  populationStabilityIndex,
  summarizePerformance,
  type GroupOutcome,
  type ObservedDecision,
} from './monitoring-analytics';
import {
  AdverseImpactQueryDto,
  MonitoringWindowQueryDto,
  RecordMonitoringAttributeBatchDto,
  RecordOutcomeBatchDto,
  StabilityQueryDto,
} from './model-monitoring.dto';

/** Techo de ejecuciones por análisis; ver la nota en `executionsIn`. */
const MAX_ANALYSIS_ROWS = 20_000;
/** Máximo de observaciones por carga: una tanda de cobranza no puede abrir una transacción sin fin. */
const MAX_BATCH = 1_000;

/**
 * Monitoreo continuo del modelo (SR 11-7 §V; CMN 4.557 art. 40).
 *
 * Hasta ahora el motor sabía qué había decidido y nadie le contaba nunca si acertó. Este
 * módulo cierra ese lazo con tres preguntas que se responden por separado porque se degradan
 * por separado:
 *
 *  - **¿sigue acertando?** — tasas reales contra el desenlace observado;
 *  - **¿le siguen llegando los mismos solicitantes?** — estabilidad poblacional;
 *  - **¿trata igual a grupos comparables?** — razón de impacto adverso.
 *
 * Ninguna de las tres emite un juicio. Producen la evidencia con la que una persona decide si
 * recalibrar, reentrenar o retirar; presentarlas como veredicto sería exactamente el tipo de
 * automatización que el propio marco pide vigilar.
 */
@Injectable()
export class ModelMonitoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Registra el desenlace real de decisiones ya tomadas.
   *
   * `upsert` por (ejecución, ventana): la evidencia se corrige —un caso marcado como impago
   * que después se regulariza—, y obligar a borrar para corregir dejaría el hueco abierto a
   * que alguien borrara sin más.
   */
  async recordOutcomes(
    tenantId: bigint,
    dto: RecordOutcomeBatchDto,
    principal: AuthenticatedPrincipal,
  ) {
    this.assertBatchSize(dto.observations.length, 'observations');
    const executionIds = dto.observations.map((entry) =>
      parseBigIntId(entry.executionId, 'executionId'),
    );
    await this.assertExecutionsBelongToTenant(tenantId, executionIds);

    const recorded = await this.prisma.$transaction(async (tx) => {
      let count = 0;
      for (const [index, observation] of dto.observations.entries()) {
        const executionId = executionIds[index];
        const data = {
          tenantId,
          executionId,
          windowDays: observation.windowDays,
          label: observation.label as ObservedOutcomeLabel,
          amount: observation.amount !== undefined ? new Prisma.Decimal(observation.amount) : null,
          source: observation.source,
          notes: observation.notes,
          recordedBy: principal.id,
          observedAt: new Date(),
        };
        await tx.decisionOutcomeObservation.upsert({
          where: {
            executionId_windowDays: { executionId, windowDays: observation.windowDays },
          },
          create: data,
          update: data,
        });
        count += 1;
      }
      await this.audit.append(
        {
          tenantId,
          eventType: 'MODEL_OUTCOMES_RECORDED',
          aggregateType: 'ModelMonitoring',
          aggregateId: String(count),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            recorded: count,
            sources: [...new Set(dto.observations.map((entry) => entry.source))],
          },
        },
        tx,
      );
      return count;
    });

    for (const observation of dto.observations) {
      this.metrics.recordObservedOutcome(observation.label);
    }
    return { recorded };
  }

  /**
   * Registra atributos que sirven SOLO para medir sesgo.
   *
   * Se escribe después de la decisión y por su propio camino: el motor no lee esta tabla y el
   * dato no cuelga del catálogo de variables, así que no puede entrar en un contrato de
   * entrada. Recoger el grupo para comprobarse a uno mismo no es usarlo para decidir, que es
   * la distinción sobre la que se apoya el autoexamen que Regulation B admite.
   */
  async recordAttributes(
    tenantId: bigint,
    dto: RecordMonitoringAttributeBatchDto,
    principal: AuthenticatedPrincipal,
  ) {
    this.assertBatchSize(dto.attributes.length, 'attributes');
    const executionIds = dto.attributes.map((entry) =>
      parseBigIntId(entry.executionId, 'executionId'),
    );
    await this.assertExecutionsBelongToTenant(tenantId, executionIds);

    const recorded = await this.prisma.$transaction(async (tx) => {
      let count = 0;
      for (const [index, attribute] of dto.attributes.entries()) {
        const executionId = executionIds[index];
        const data = {
          tenantId,
          executionId,
          attribute: attribute.attribute,
          groupValue: attribute.groupValue,
          recordedBy: principal.id,
        };
        await tx.decisionMonitoringAttribute.upsert({
          where: {
            executionId_attribute: { executionId, attribute: attribute.attribute },
          },
          create: data,
          update: data,
        });
        count += 1;
      }
      await this.audit.append(
        {
          tenantId,
          eventType: 'MODEL_MONITORING_ATTRIBUTES_RECORDED',
          aggregateType: 'ModelMonitoring',
          aggregateId: String(count),
          actorId: principal.id,
          requestId: principal.requestId,
          // Los NOMBRES de atributo, nunca los valores: el registro de auditoría no es sitio
          // para la composición demográfica de una cartera.
          payload: {
            recorded: count,
            attributes: [...new Set(dto.attributes.map((entry) => entry.attribute))],
          },
        },
        tx,
      );
      return count;
    });

    return { recorded };
  }

  /** ¿El modelo sigue acertando? */
  async performance(tenantId: bigint, query: MonitoringWindowQueryDto) {
    const artifactVersionId = parseBigIntId(query.artifactVersionId, 'artifactVersionId');
    await this.assertVersionBelongsToTenant(tenantId, artifactVersionId);

    const rows = await this.prisma.decisionExecution.findMany({
      where: {
        tenantId,
        artifactVersionId,
        ...this.executedAtFilter(query),
        // Solo lo observado: una ejecución sin desenlace no dice nada del desempeño.
        outcomeObservations: { some: {} },
      },
      take: MAX_ANALYSIS_ROWS,
      select: {
        businessOutcome: true,
        outputJson: true,
        outcomeObservations: { orderBy: { windowDays: 'desc' }, take: 1 },
      },
    });

    const decisions: ObservedDecision[] = rows.map((row) => ({
      outcome: row.businessOutcome,
      label: row.outcomeObservations[0].label,
      score: this.scoreOf(row.outputJson),
    }));
    const summary = summarizePerformance(decisions);
    if (summary.badRate !== null) {
      this.metrics.setModelBadRate(query.artifactVersionId, summary.badRate);
    }
    return { artifactVersionId: query.artifactVersionId, ...summary };
  }

  /** ¿Le siguen llegando los mismos solicitantes? */
  async stability(tenantId: bigint, query: StabilityQueryDto) {
    const artifactVersionId = parseBigIntId(query.artifactVersionId, 'artifactVersionId');
    await this.assertVersionBelongsToTenant(tenantId, artifactVersionId);

    const bucketsOf = async (from: Date, to: Date) => {
      const rows = await this.prisma.decisionExecution.findMany({
        where: { tenantId, artifactVersionId, executedAt: { gte: from, lte: to } },
        take: MAX_ANALYSIS_ROWS,
        select: { inputSnapshotJson: true },
      });
      return rows
        .map((row) => this.bucketOf(row.inputSnapshotJson, query.variableCode))
        .filter((bucket): bucket is string => bucket !== null);
    };

    const reference = await bucketsOf(new Date(query.referenceFrom), new Date(query.referenceTo));
    const current = await bucketsOf(
      query.from ? new Date(query.from) : new Date(query.referenceTo),
      query.to ? new Date(query.to) : new Date(),
    );
    const result = populationStabilityIndex(reference, current);
    this.metrics.setModelPsi(query.artifactVersionId, query.variableCode, result.psi);
    return {
      artifactVersionId: query.artifactVersionId,
      variableCode: query.variableCode,
      ...result,
    };
  }

  /** ¿Trata igual a grupos comparables? */
  async adverseImpact(tenantId: bigint, query: AdverseImpactQueryDto) {
    const artifactVersionId = parseBigIntId(query.artifactVersionId, 'artifactVersionId');
    await this.assertVersionBelongsToTenant(tenantId, artifactVersionId);

    const rows = await this.prisma.decisionExecution.findMany({
      where: {
        tenantId,
        artifactVersionId,
        ...this.executedAtFilter(query),
        monitoringAttributes: { some: { attribute: query.attribute } },
      },
      take: MAX_ANALYSIS_ROWS,
      select: {
        businessOutcome: true,
        monitoringAttributes: { where: { attribute: query.attribute }, take: 1 },
      },
    });

    const outcomes: GroupOutcome[] = rows.map((row) => ({
      group: row.monitoringAttributes[0].groupValue,
      approved: isApproval(row.businessOutcome),
    }));
    const result = adverseImpactRatios(query.attribute, outcomes);
    for (const group of result.groups) {
      this.metrics.setAdverseImpactRatio(
        query.artifactVersionId,
        query.attribute,
        group.group,
        group.impactRatio,
      );
    }
    return { artifactVersionId: query.artifactVersionId, analyzed: outcomes.length, ...result };
  }

  // ---------------------------------------------------------------------------

  private assertBatchSize(size: number, field: string): void {
    if (size === 0) {
      throw new DomainException(
        'MONITORING_BATCH_EMPTY',
        `El lote de ${field} está vacío`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (size > MAX_BATCH) {
      throw new DomainException(
        'MONITORING_BATCH_TOO_LARGE',
        `Un lote admite como máximo ${MAX_BATCH} ${field}; divídalo`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Las ejecuciones referidas tienen que ser de este tenant.
   *
   * `decision_outcome_observation` sí lleva `tenant_id` y su RLS lo protege, pero nada impide
   * escribir una fila con MI tenant apuntando a la ejecución de otro: la política comprueba la
   * columna, no la coherencia del vínculo. Sin esta comprobación, el análisis de un cliente
   * podría contaminarse con desenlaces inventados sobre decisiones ajenas.
   */
  private async assertExecutionsBelongToTenant(
    tenantId: bigint,
    executionIds: bigint[],
  ): Promise<void> {
    const unique = [...new Set(executionIds.map(String))].map((id) => BigInt(id));
    const found = await this.prisma.decisionExecution.count({
      where: { tenantId, id: { in: unique } },
    });
    if (found !== unique.length) {
      throw new DomainException(
        'EXECUTION_NOT_FOUND',
        'Alguna de las ejecuciones referidas no existe en este tenant',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async assertVersionBelongsToTenant(
    tenantId: bigint,
    artifactVersionId: bigint,
  ): Promise<void> {
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: artifactVersionId, artifact: { tenantId } },
      select: { id: true },
    });
    if (!version) {
      throw new DomainException(
        'VERSION_NOT_FOUND',
        'Artifact version not found',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private executedAtFilter(query: MonitoringWindowQueryDto) {
    if (!query.from && !query.to) return {};
    return {
      executedAt: {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      },
    };
  }

  /** Puntaje publicado por la decisión, cuando el artefacto lo produce. */
  private scoreOf(output: Prisma.JsonValue | null): number | null {
    if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
    const score = (output as Record<string, unknown>).score;
    return typeof score === 'number' && Number.isFinite(score) ? score : null;
  }

  /**
   * Categoría de una variable en una ejecución, para el índice de estabilidad.
   *
   * Delega en `bucketOfSnapshot`, que es la ÚNICA definición. Tenerla duplicada aquí y en la
   * captura de la línea base era una bomba de relojería: en cuanto las dos se separasen, el
   * índice compararía dos alfabetos distintos y saldría altísimo siempre.
   */
  private bucketOf(snapshot: Prisma.JsonValue | null, variableCode: string): string | null {
    return bucketOfSnapshot(snapshot, variableCode);
  }
}
