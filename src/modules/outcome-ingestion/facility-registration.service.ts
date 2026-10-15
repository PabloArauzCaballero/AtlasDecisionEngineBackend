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
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExecutionStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { parseBigIntId } from '../../common/http/id';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { parseWindowDays, windowDueAt } from '../runtime/outcome-windows';
import { assertBatchSize, rejectRow, type RowResult } from './outcome-batch.rules';
import type { RegisterFacilityBatchDto, RegisterFacilityDto } from './outcome-ingestion.dto';

@Injectable()
export class FacilityRegistrationService {
  private readonly logger = new Logger(FacilityRegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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
    assertBatchSize(dto.facilities.length, 'facilities');
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
        return rejectRow(facility.externalReference, error.code, error.message);
      }
      this.logger.error(
        `No se pudo registrar el crédito ${facility.externalReference}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return rejectRow(
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
      return rejectRow(
        facility.externalReference,
        'EXECUTION_NOT_FOUND',
        'La decisión que se cita no existe en este tenant.',
      );
    }
    if (execution.decisionStatus !== ExecutionStatus.SUCCEEDED) {
      return rejectRow(
        facility.externalReference,
        'EXECUTION_NOT_DECIDED',
        'La decisión que se cita no terminó (NO_DECISION o FAILED): no puede haber originado un ' +
          'crédito. Un crédito sólo se registra contra una decisión tomada.',
      );
    }
    if (!execution.subjectId) {
      return rejectRow(
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
          return rejectRow(
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
}
