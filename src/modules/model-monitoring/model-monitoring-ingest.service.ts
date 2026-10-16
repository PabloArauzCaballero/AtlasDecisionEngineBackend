import { HttpStatus, Injectable } from '@nestjs/common';
import { ObservedOutcomeLabel, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { ModelMonitoringMetrics } from '../../common/observability/model-monitoring-metrics';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { RecordMonitoringAttributeBatchDto, RecordOutcomeBatchDto } from './model-monitoring.dto';

/** Máximo de observaciones por carga: una tanda de cobranza no puede abrir una transacción sin fin. */
const MAX_BATCH = 1_000;

@Injectable()
export class ModelMonitoringIngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly metrics: ModelMonitoringMetrics,
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

  assertBatchSize(size: number, field: string): void {
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
}
