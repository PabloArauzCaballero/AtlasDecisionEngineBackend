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
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExecutionStatus, ObservedOutcomeLabel, Prisma } from '@prisma/client';
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
  /** Ya estaba registrada igual: aceptada sin reescribir ni contar. */
  duplicate?: boolean;
}

@Injectable()
export class OutcomeIngestionService {
  private readonly logger = new Logger(OutcomeIngestionService.name);

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
  ): Promise<{ registered: number; rejected: number; duplicates: number; rows: RowResult[] }> {
    this.assertBatchSize(dto.facilities.length, 'facilities');
    const windows = parseWindowDays(this.config.get<string>('OUTCOME_WINDOW_DAYS'));
    const rows: RowResult[] = [];
    let registered = 0;
    let duplicates = 0;

    for (const facility of dto.facilities) {
      const outcome = await this.registerOneSafely(tenantId, facility, windows);
      rows.push(outcome);
      if (outcome.accepted) registered += 1;
      if (outcome.duplicate) duplicates += 1;
    }

    await this.audit.append({
      tenantId,
      eventType: 'CREDIT_FACILITIES_REGISTERED',
      aggregateType: 'CreditFacility',
      aggregateId: String(registered),
      actorId: principal.id,
      requestId: principal.requestId,
      payload: { registered, duplicates, rejected: rows.length - registered },
    });
    return { registered, rejected: rows.length - registered, duplicates, rows };
  }

  /**
   * Una fila que falla no se lleva el lote por delante.
   *
   * Cada crédito se escribe en su propia transacción; antes, una excepción en la fila k cortaba el
   * bucle con las anteriores ya escritas, sin auditoría y con un 500 que invitaba a reenviar todo.
   * Ahora la fila fallida vuelve con su código y el resto sigue: reenviar el lote es seguro porque
   * el registro es idempotente por referencia externa.
   */
  private async registerOneSafely(
    tenantId: bigint,
    facility: RegisterFacilityDto,
    windows: number[],
  ): Promise<RowResult> {
    try {
      return await this.registerOne(tenantId, facility, windows);
    } catch (error) {
      if (error instanceof DomainException) {
        return this.reject(facility.externalReference, error.code, error.message);
      }
      this.logger.error(
        `No se pudo registrar el crédito ${facility.externalReference}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.reject(
        facility.externalReference,
        'FACILITY_REGISTRATION_FAILED',
        'Fallo al escribir esta fila; el resto del lote siguió. Reenviarla es seguro.',
      );
    }
  }

  private async registerOne(
    tenantId: bigint,
    facility: RegisterFacilityDto,
    windows: number[],
  ): Promise<RowResult> {
    const executionId = parseBigIntId(facility.originationExecutionId, 'originationExecutionId');
    const execution = await this.prisma.decisionExecution.findFirst({
      where: { tenantId, id: executionId },
      select: { id: true, subjectId: true, executedAt: true, decisionStatus: true },
    });
    if (!execution) {
      return this.reject(
        facility.externalReference,
        'EXECUTION_NOT_FOUND',
        'La decisión que se cita no existe en este tenant.',
      );
    }
    if (execution.decisionStatus !== ExecutionStatus.SUCCEEDED) {
      return this.reject(
        facility.externalReference,
        'EXECUTION_NOT_DECIDED',
        'La decisión que se cita no terminó (NO_DECISION o FAILED): no puede haber originado un ' +
          'crédito. Un crédito sólo se registra contra una decisión tomada.',
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
    const subjectId = execution.subjectId;

    return this.prisma.$transaction(async (tx) => {
      const data = {
        principalAmount: new Prisma.Decimal(facility.principalAmount),
        termMonths: facility.termMonths,
        annualRate: new Prisma.Decimal(facility.annualRate),
        disbursedAt: facility.disbursedAt ? new Date(facility.disbursedAt) : null,
      };
      /*
       * Idempotente por referencia externa, y la identidad NO se reescribe.
       *
       * `INSERT … ON CONFLICT DO NOTHING` y no `upsert`: dos altas simultáneas del mismo crédito
       * no se abortan con P2002. Si ya existía, se compara su identidad —sujeto y decisión de
       * origen— con la de esta fila: igual es un reenvío y sólo se actualizan los datos del
       * desembolso; distinta es un conflicto y se rechaza. Antes el reenvío citando OTRA decisión
       * se aceptaba y ataba al crédito las ventanas de una ejecución de otra persona.
       */
      const inserted = await tx.$queryRaw<Array<{ id: bigint }>>`
        INSERT INTO "credit_facility" (
          "tenant_id", "subject_id", "external_reference", "origination_execution_id",
          "principal_amount", "currency_code", "term_months", "annual_rate", "disbursed_at"
        ) VALUES (
          ${tenantId}, ${subjectId}, ${facility.externalReference}, ${execution.id},
          ${data.principalAmount}, ${facility.currencyCode.toUpperCase()}, ${data.termMonths},
          ${data.annualRate}, ${data.disbursedAt}
        )
        ON CONFLICT ("tenant_id", "external_reference") DO NOTHING
        RETURNING "id"
      `;
      let facilityId: bigint;
      let duplicate = false;
      if (inserted.length) {
        facilityId = inserted[0].id;
      } else {
        const existing = await tx.creditFacility.findUniqueOrThrow({
          where: {
            tenantId_externalReference: { tenantId, externalReference: facility.externalReference },
          },
          select: { id: true, subjectId: true, originationExecutionId: true },
        });
        if (existing.subjectId !== subjectId || existing.originationExecutionId !== execution.id) {
          return this.reject(
            facility.externalReference,
            'FACILITY_REFERENCE_CONFLICT',
            'Ese crédito ya está registrado contra otra decisión u otro titular. Un reenvío no ' +
              'puede reasignarlo: si el vínculo está mal, se corrige con un proceso explícito.',
          );
        }
        // Reenviar el mismo préstamo es lo normal en una conciliación diaria: se actualiza el
        // desembolso y poco más. El sujeto y la decisión de origen NO se tocan.
        await tx.creditFacility.update({ where: { id: existing.id }, data });
        facilityId = existing.id;
        duplicate = true;
      }

      // Las ventanas cuelgan de la ejecución (ya existen desde que se decidió) y aquí sólo se
      // les ata el crédito. Si la decisión no las tenía —artefacto que no es de originación,
      // o anterior a esta migración— se crean ahora contando desde la decisión, no desde hoy:
      // una ventana de 90 días medida desde la carga mediría el retraso de la conciliación.
      await tx.outcomeWindowSchedule.updateMany({
        where: { tenantId, executionId: execution.id },
        data: { facilityId },
      });
      await tx.outcomeWindowSchedule.createMany({
        data: windows.map((windowDays) => ({
          tenantId,
          executionId: execution.id,
          facilityId,
          windowDays,
          dueAt: windowDueAt(execution.executedAt, windowDays),
        })),
        skipDuplicates: true,
      });
      return {
        externalReference: facility.externalReference,
        accepted: true,
        ...(duplicate ? { duplicate: true } : {}),
      };
    });
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
  ): Promise<{
    accepted: number;
    rejected: number;
    duplicates: number;
    dryRun: boolean;
    rows: RowResult[];
  }> {
    this.assertBatchSize(dto.outcomes.length, 'outcomes');
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
            this.reject(
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

function observationKey(executionId: bigint, windowDays: number): string {
  return `${executionId.toString()}:${windowDays}`;
}

/** Lo que identifica un desenlace a efectos de «es el mismo»: etiqueta, importe y método. */
function fingerprint(
  label: string,
  amount: number | null,
  inferenceMethod: string | null | undefined,
): string {
  return JSON.stringify([label, amount === null ? null : Number(amount), inferenceMethod ?? null]);
}
