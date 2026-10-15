import { Injectable } from '@nestjs/common';
import { ObservedOutcomeLabel, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { ModelMonitoringMetrics } from '../../common/observability/model-monitoring-metrics';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import {
  assertBatchSize,
  fingerprint,
  observationKey,
  rejectRow,
  type RowResult,
} from './outcome-batch.rules';
import type { FacilityOutcomeBatchDto } from './outcome-ingestion.dto';

@Injectable()
export class OutcomeRecordingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly metrics: ModelMonitoringMetrics,
  ) {}

  /**
   * Registra desenlaces observados sobre créditos ya conocidos.
   *
   * `dryRun` no es una comodidad: una carga trae miles de filas, y descubrir en la 4000 que una
   * referencia no existía —con 3999 ya escritas sobre evidencia regulatoria— obliga a un
   * borrado manual sobre la tabla que justamente no se debe borrar a mano. Se valida entero
   * primero y se escribe entero después.
   */
  async recordBatch(
    tenantId: bigint,
    dto: FacilityOutcomeBatchDto,
    principal: AuthenticatedPrincipal,
  ): Promise<{
    accepted: number;
    rejected: number;
    duplicates: number;
    dryRun: boolean;
    rows: RowResult[];
  }> {
    assertBatchSize(dto.outcomes.length, 'outcomes');
    const references = [...new Set(dto.outcomes.map((entry) => entry.externalReference))];
    const facilities = await this.prisma.creditFacility.findMany({
      where: { tenantId, externalReference: { in: references } },
      select: { id: true, externalReference: true, originationExecutionId: true },
    });
    const byReference = new Map(
      facilities.map((facility) => [facility.externalReference, facility]),
    );
    const executionIds = facilities
      .map((facility) => facility.originationExecutionId)
      .filter((id): id is bigint => id !== null);
    // Lo ya observado, para distinguir un REENVÍO (igual: no se reescribe ni se cuenta) de un
    // CONFLICTO (otra etiqueta para la misma ventana: se rechaza, no se pisa la evidencia).
    const existingObservations = executionIds.length
      ? await this.prisma.decisionOutcomeObservation.findMany({
          where: { tenantId, executionId: { in: executionIds } },
          select: {
            executionId: true,
            windowDays: true,
            label: true,
            amount: true,
            inferenceMethod: true,
          },
        })
      : [];
    const observed = new Map(
      existingObservations.map((row) => [
        observationKey(row.executionId, row.windowDays),
        fingerprint(
          row.label,
          row.amount === null ? null : Number(row.amount),
          row.inferenceMethod,
        ),
      ]),
    );

    const rows: RowResult[] = [];
    const writable: Array<{
      facilityId: bigint;
      executionId: bigint;
      entry: (typeof dto.outcomes)[number];
    }> = [];
    const duplicatesToClose: Array<{ executionId: bigint; windowDays: number }> = [];
    for (const entry of dto.outcomes) {
      const facility = byReference.get(entry.externalReference);
      if (!facility) {
        rows.push(
          rejectRow(
            entry.externalReference,
            'FACILITY_NOT_FOUND',
            'El crédito no está dado de alta.',
            entry.windowDays,
          ),
        );
        continue;
      }
      if (!facility.originationExecutionId) {
        rows.push(
          rejectRow(
            entry.externalReference,
            'FACILITY_WITHOUT_ORIGINATION',
            'El crédito no cita la decisión que lo originó, así que su desenlace no puede ' +
              'medir ninguna política.',
            entry.windowDays,
          ),
        );
        continue;
      }
      const key = observationKey(facility.originationExecutionId, entry.windowDays);
      const incoming = fingerprint(
        entry.label,
        entry.amount ?? null,
        entry.inferenceMethod ?? null,
      );
      const previous = observed.get(key);
      if (previous !== undefined) {
        if (previous !== incoming) {
          rows.push(
            rejectRow(
              entry.externalReference,
              'OUTCOME_CONFLICT',
              'Esa ventana ya tiene un desenlace distinto. Un reenvío no reescribe evidencia: ' +
                'una corrección es un proceso explícito.',
              entry.windowDays,
            ),
          );
          continue;
        }
        rows.push({
          externalReference: entry.externalReference,
          windowDays: entry.windowDays,
          accepted: true,
          duplicate: true,
        });
        duplicatesToClose.push({
          executionId: facility.originationExecutionId,
          windowDays: entry.windowDays,
        });
        continue;
      }
      // Dentro del mismo lote cuenta igual: la segunda aparición es reenvío o conflicto.
      observed.set(key, incoming);
      rows.push({
        externalReference: entry.externalReference,
        windowDays: entry.windowDays,
        accepted: true,
      });
      writable.push({
        facilityId: facility.id,
        executionId: facility.originationExecutionId,
        entry,
      });
    }

    const accepted = rows.filter((row) => row.accepted).length;
    const duplicates = rows.filter((row) => row.duplicate).length;
    if (dto.dryRun) {
      return { accepted, rejected: rows.length - accepted, duplicates, dryRun: true, rows };
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const { facilityId, executionId, entry } of writable) {
        const data = {
          tenantId,
          executionId,
          facilityId,
          windowDays: entry.windowDays,
          label: entry.label as ObservedOutcomeLabel,
          amount: entry.amount !== undefined ? new Prisma.Decimal(entry.amount) : null,
          source: entry.source,
          inferenceMethod: entry.inferenceMethod ?? null,
          notes: entry.notes,
          recordedBy: principal.id,
          observedAt: now,
        };
        // `createMany … skipDuplicates`: si otra carga concurrente escribió la misma ventana
        // entre la lectura y aquí, no se pisa ni aborta el lote.
        await tx.decisionOutcomeObservation.createMany({ data: [data], skipDuplicates: true });
      }
      // Cerrar la ventana es lo que mueve el denominador. Se cierra también en los reenvíos:
      // una observación cargada por la vía antigua (`/v1/model-monitoring/outcomes`) dejaba la
      // ventana abierta, y el reenvío por aquí es justo lo que la cierra. Sólo si sigue abierta:
      // la fecha de cierre original no se mueve.
      for (const target of [...writable, ...duplicatesToClose]) {
        const windowDays = 'entry' in target ? target.entry.windowDays : target.windowDays;
        await tx.outcomeWindowSchedule.updateMany({
          where: { tenantId, executionId: target.executionId, windowDays, observedAt: null },
          data: { observedAt: now },
        });
      }
      await this.audit.append(
        {
          tenantId,
          eventType: 'MODEL_OUTCOMES_RECORDED',
          aggregateType: 'ModelMonitoring',
          aggregateId: String(writable.length),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            recorded: writable.length,
            duplicates,
            rejected: rows.length - accepted,
            sources: [...new Set(dto.outcomes.map((entry) => entry.source))],
          },
        },
        tx,
      );
    });

    // El numerador sólo cuenta lo NUEVO. Un reenvío que volviera a sumar inflaría la tasa de
    // malos con cada conciliación diaria.
    for (const { entry } of writable) this.metrics.recordObservedOutcome(entry.label);
    return { accepted, rejected: rows.length - accepted, duplicates, dryRun: false, rows };
  }
}
