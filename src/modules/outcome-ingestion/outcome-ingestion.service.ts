/**
 * La tubería por la que vuelve el resultado real de una decisión.
 *
 * `POST /v1/model-monitoring/outcomes` existía desde hacía meses y su tabla estaba vacía. No
 * por un fallo: por una ausencia. Había una PUERTA y no había tubería — nadie conciliaba con el
 * sistema de cartera, nada programaba las ventanas, y no había forma de saber cuántos
 * desenlaces faltaban porque no existía el denominador.
 *
 * Este módulo pone la tubería, y lo hace por el identificador que el otro lado conoce: el
 * sistema de cobranza sabe de préstamos, no del identificador interno de la ejecución que los
 * aprobó. Pedirle esa traducción era pedirle que mantuviera un mapa que ya vive aquí, y un
 * mapa duplicado y desactualizado habría sido la primera fuente de desenlaces atribuidos al
 * crédito equivocado.
 */
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ObservedOutcomeLabel, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { MetricsService } from '../../common/observability/metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { parseWindowDays, windowDueAt } from '../runtime/outcome-windows';
import type {
  FacilityOutcomeBatchDto,
  RegisterFacilityBatchDto,
  RegisterFacilityDto,
} from './outcome-ingestion.dto';

/** Techo por carga. Una tanda de cobranza no puede abrir una transacción sin fin. */
const MAX_BATCH = 2_000;

/** Resultado de UNA fila, para que el rechazo se explique fila a fila y no en bloque. */
export interface RowResult {
  externalReference: string;
  windowDays?: number;
  accepted: boolean;
  /** Código estable del rechazo. Nulo si se aceptó. */
  code?: string;
  message?: string;
}

@Injectable()
export class OutcomeIngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Da de alta los créditos concedidos y les programa sus ventanas de observación.
   *
   * El sujeto se toma de la ejecución que originó el crédito y no del cuerpo de la petición:
   * el core no conoce el seudónimo del motor, y dejarle mandarlo abriría la puerta a atar un
   * préstamo a la persona equivocada por una errata en un identificador.
   */
  async registerFacilities(
    tenantId: bigint,
    dto: RegisterFacilityBatchDto,
    principal: AuthenticatedPrincipal,
  ): Promise<{ registered: number; rejected: number; rows: RowResult[] }> {
    this.assertBatchSize(dto.facilities.length, 'facilities');
    const windows = parseWindowDays(this.config.get<string>('OUTCOME_WINDOW_DAYS'));
    const rows: RowResult[] = [];
    let registered = 0;

    for (const facility of dto.facilities) {
      const outcome = await this.registerOne(tenantId, facility, windows);
      rows.push(outcome);
      if (outcome.accepted) registered += 1;
    }

    await this.audit.append({
      tenantId,
      eventType: 'CREDIT_FACILITIES_REGISTERED',
      aggregateType: 'CreditFacility',
      aggregateId: String(registered),
      actorId: principal.id,
      requestId: principal.requestId,
      payload: { registered, rejected: rows.length - registered },
    });
    return { registered, rejected: rows.length - registered, rows };
  }

  private async registerOne(
    tenantId: bigint,
    facility: RegisterFacilityDto,
    windows: number[],
  ): Promise<RowResult> {
    const executionId = parseBigIntId(facility.originationExecutionId, 'originationExecutionId');
    const execution = await this.prisma.decisionExecution.findFirst({
      where: { tenantId, id: executionId },
      select: { id: true, subjectId: true, executedAt: true },
    });
    if (!execution) {
      return this.reject(
        facility.externalReference,
        'EXECUTION_NOT_FOUND',
        'La decisión que se cita no existe en este tenant.',
      );
    }
    if (!execution.subjectId) {
      return this.reject(
        facility.externalReference,
        'EXECUTION_WITHOUT_SUBJECT',
        'La decisión que originó este crédito no identificó al solicitante, así que el ' +
          'crédito no puede atribuirse a nadie. La referencia se guarda en HMAC de una vía y ' +
          'no se puede añadir después.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      const created = await tx.creditFacility.upsert({
        where: {
          tenantId_externalReference: { tenantId, externalReference: facility.externalReference },
        },
        create: {
          tenantId,
          subjectId: execution.subjectId as bigint,
          externalReference: facility.externalReference,
          originationExecutionId: execution.id,
          principalAmount: new Prisma.Decimal(facility.principalAmount),
          currencyCode: facility.currencyCode.toUpperCase(),
          termMonths: facility.termMonths,
          annualRate: new Prisma.Decimal(facility.annualRate),
          disbursedAt: facility.disbursedAt ? new Date(facility.disbursedAt) : null,
        },
        // Reenviar el mismo préstamo es lo normal en una conciliación diaria: se actualiza el
        // desembolso y poco más. El sujeto y la decisión de origen NO se tocan — reasignar un
        // crédito a otra persona por una carga repetida sería el peor fallo posible aquí.
        update: {
          principalAmount: new Prisma.Decimal(facility.principalAmount),
          termMonths: facility.termMonths,
          annualRate: new Prisma.Decimal(facility.annualRate),
          disbursedAt: facility.disbursedAt ? new Date(facility.disbursedAt) : null,
        },
        select: { id: true },
      });

      // Las ventanas cuelgan de la ejecución (ya existen desde que se decidió) y aquí sólo se
      // les ata el crédito. Si la decisión no las tenía —artefacto que no es de originación,
      // o anterior a esta migración— se crean ahora contando desde la decisión, no desde hoy:
      // una ventana de 90 días medida desde la carga mediría el retraso de la conciliación.
      await tx.outcomeWindowSchedule.updateMany({
        where: { tenantId, executionId: execution.id },
        data: { facilityId: created.id },
      });
      await tx.outcomeWindowSchedule.createMany({
        data: windows.map((windowDays) => ({
          tenantId,
          executionId: execution.id,
          facilityId: created.id,
          windowDays,
          dueAt: windowDueAt(execution.executedAt, windowDays),
        })),
        skipDuplicates: true,
      });
    });

    return { externalReference: facility.externalReference, accepted: true };
  }

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
  ): Promise<{ accepted: number; rejected: number; dryRun: boolean; rows: RowResult[] }> {
    this.assertBatchSize(dto.outcomes.length, 'outcomes');
    const references = [...new Set(dto.outcomes.map((entry) => entry.externalReference))];
    const facilities = await this.prisma.creditFacility.findMany({
      where: { tenantId, externalReference: { in: references } },
      select: { id: true, externalReference: true, originationExecutionId: true },
    });
    const byReference = new Map(
      facilities.map((facility) => [facility.externalReference, facility]),
    );

    const rows: RowResult[] = [];
    const writable: Array<{
      facilityId: bigint;
      executionId: bigint;
      entry: (typeof dto.outcomes)[number];
    }> = [];
    for (const entry of dto.outcomes) {
      const facility = byReference.get(entry.externalReference);
      if (!facility) {
        rows.push(
          this.reject(
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
          this.reject(
            entry.externalReference,
            'FACILITY_WITHOUT_ORIGINATION',
            'El crédito no cita la decisión que lo originó, así que su desenlace no puede ' +
              'medir ninguna política.',
            entry.windowDays,
          ),
        );
        continue;
      }
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

    if (dto.dryRun) {
      return {
        accepted: writable.length,
        rejected: rows.length - writable.length,
        dryRun: true,
        rows,
      };
    }

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
          observedAt: new Date(),
        };
        await tx.decisionOutcomeObservation.upsert({
          where: { executionId_windowDays: { executionId, windowDays: entry.windowDays } },
          create: data,
          update: data,
        });
        // Cerrar la ventana es lo que mueve el denominador. Sin esto la observación existiría
        // y la cola de pendientes seguiría reclamándola para siempre.
        await tx.outcomeWindowSchedule.updateMany({
          where: { tenantId, executionId, windowDays: entry.windowDays },
          data: { observedAt: new Date() },
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
            rejected: rows.length - writable.length,
            sources: [...new Set(dto.outcomes.map((entry) => entry.source))],
          },
        },
        tx,
      );
    });

    for (const { entry } of writable) this.metrics.recordObservedOutcome(entry.label);
    return {
      accepted: writable.length,
      rejected: rows.length - writable.length,
      dryRun: false,
      rows,
    };
  }

  private reject(
    externalReference: string,
    code: string,
    message: string,
    windowDays?: number,
  ): RowResult {
    return { externalReference, windowDays, accepted: false, code, message };
  }

  private assertBatchSize(size: number, field: string): void {
    if (size === 0) {
      throw new DomainException(
        'OUTCOME_BATCH_EMPTY',
        `El lote de ${field} está vacío`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (size > MAX_BATCH) {
      throw new DomainException(
        'OUTCOME_BATCH_TOO_LARGE',
        `Un lote admite como máximo ${MAX_BATCH} ${field}; divídalo`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
