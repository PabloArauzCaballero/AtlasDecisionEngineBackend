import { Injectable } from '@nestjs/common';
import { MonitoringVerdict, Prisma } from '@prisma/client';
import { JobName } from '../../common/jobs/job-names';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  DecisionEventType,
  type MonitoringBreachDetectedPayload,
} from '../../common/events/event-types';
import { OutboxPublisherService } from '../../common/events/outbox-publisher.service';
import type { LiveVersion, Measurement } from './monitoring-measurement';
import { thresholdOf, verdictFor } from './monitoring-thresholds';

@Injectable()
export class MonitoringEvaluationWriter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxPublisherService,
  ) {}

  /**
   * Guarda la medición y avisa si es un `BREACH`.
   *
   * El aviso va por el outbox transaccional que ya alimenta `Notification`, no por una tubería
   * nueva: un canal de avisos propio sería otra cosa que puede callarse sin que nadie lo note.
   */
  async persist(version: LiveVersion, measurement: Measurement): Promise<void> {
    const verdict = verdictFor(measurement.metricCode, measurement.value, measurement.sampleSize);
    await this.prisma.$transaction(async (tx) => {
      await tx.monitoringEvaluation.create({
        data: {
          tenantId: version.tenantId,
          artifactVersionId: version.artifactVersionId,
          metricCode: measurement.metricCode,
          scope: measurement.scope,
          value: new Prisma.Decimal(measurement.value),
          threshold: new Prisma.Decimal(thresholdOf(measurement.metricCode)),
          verdict,
          sampleSize: measurement.sampleSize,
          detailsJson: measurement.details as Prisma.InputJsonValue,
        },
      });
      if (verdict === MonitoringVerdict.BREACH) {
        await this.outbox.publish(tx, {
          tenantId: version.tenantId,
          eventType: DecisionEventType.MONITORING_BREACH_DETECTED,
          aggregateType: 'MonitoringEvaluation',
          aggregateId: version.artifactVersionId.toString(),
          // El actor es el propio trabajo. Poner aquí un usuario sería mentir sobre quién lo
          // detectó, y el valor de este aviso es justamente que no lo detectó nadie.
          actorId: JobName.MonitoringEvaluation,
          payload: {
            artifactCode: version.artifactCode,
            metricCode: measurement.metricCode,
            scope: measurement.scope,
            value: measurement.value,
            threshold: thresholdOf(measurement.metricCode),
            sampleSize: measurement.sampleSize,
          } satisfies MonitoringBreachDetectedPayload,
        });
      }
    });
  }
}
