import { HttpStatus, Injectable } from '@nestjs/common';
import { WorkerRunStatus } from '@prisma/client';
import { AuditService } from '../../../../common/audit/audit.service';
import { DomainException } from '../../../../common/errors/domain-exception';
import { JobName } from '../../../../common/jobs/job-names';
import { JobSignalService } from '../../../../common/jobs/job-signal.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../../../common/security/security.types';
import { BOLIVIA_INSTITUTIONS } from '../core/institutions/bolivia-institutions';
import { requeueFields } from './requeue-fields';
import { StatementReviewAssignment } from './statement-review-assignment.service';
import { StatementReviewDocuments } from './statement-review-documents.service';
import type { StatementReprocessedDto } from './statement-review.dto';

/** Estados cerrados que pueden volver a analizarse si no dejaron nada utilizable. */
const REABRIBLES: readonly WorkerRunStatus[] = [
  WorkerRunStatus.SUCCEEDED_WITH_WARNINGS,
  WorkerRunStatus.FAILED,
];

@Injectable()
export class StatementReprocessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobSignal: JobSignalService,
    private readonly assignment: StatementReviewAssignment,
    private readonly documents: StatementReviewDocuments,
  ) {}

  /**
   * Devuelve el caso a la cola del worker para volver a intentarlo.
   *
   * Es la acción que da sentido a conservar el documento mientras el caso está
   * abierto: sin bytes no hay reproceso, y pedirle a quien subió el extracto que
   * vuelva a buscarlo en su disco para que el motor lo intente otra vez con los
   * umbrales ya corregidos es trasladarle el trabajo de arreglar el motor.
   */
  async reprocess(
    tenantId: bigint,
    requestId: string,
    principal: AuthenticatedPrincipal,
    /** La entidad que asigna quien revisa, después de ver el PDF. Ver `ReprocessStatementReviewDto`. */
    institutionCode?: string,
  ) {
    const current = await this.assignment.assertAssignee(tenantId, requestId, principal);
    const assigned = institutionCode?.trim()
      ? await this.assertKnownInstitution(tenantId, institutionCode)
      : undefined;
    if (
      !(await current.documentAvailable()) &&
      !(await this.documents.ensureWorkingCopy(tenantId, requestId))
    ) {
      throw new DomainException(
        'BANK_STATEMENT_DOCUMENT_UNAVAILABLE',
        'El documento original ya no está disponible: hay que volver a subirlo.',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.bankStatementRun.update({
        where: { tenantId_requestId: { tenantId, requestId } },
        data: requeueFields(principal, assigned),
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'BANK_STATEMENT_REVIEW_REPROCESSED',
          aggregateType: 'BankStatementRun',
          aggregateId: requestId,
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            requestId,
            previousReviewReason: current.reviewReason,
            ...(assigned ? { assignedInstitutionCode: assigned } : {}),
          },
        },
        tx,
      );
      // Dentro de la transacción por lo mismo que en el alta: Postgres sólo
      // entrega el aviso si esto confirma.
      await this.jobSignal.notify(tx, JobName.BankStatement);
    });
    const reencolado: StatementReprocessedDto = {
      requestId,
      status: WorkerRunStatus.QUEUED,
    };
    return reencolado;
  }

  /**
   * Volver a analizar una ejecución CERRADA que no dejó resultado ni movimientos (2026-10-15).
   *
   * En TEST había una `SUCCEEDED_WITH_WARNINGS` sin resultado ni movimientos —un caso de banco no
   * reconocido aprobado antes de que existiera el análisis provisional— y, como la deduplicación por
   * huella devuelve esa misma ejecución a quien vuelve a subir el PDF, se quedaba así para siempre. Aquí
   * se reanaliza la MISMA fila con el mismo documento (restaurado desde el almacén si hace falta), con el
   * padrón de hoy y, si se pide, con la entidad asignada a mano. Una ejecución con resultado no se reabre:
   * su análisis ya existe y es el que se aplicó.
   */
  async reprocessRun(
    tenantId: bigint,
    requestId: string,
    principal: AuthenticatedPrincipal,
    institutionCode?: string,
  ): Promise<StatementReprocessedDto> {
    const run = await this.prisma.bankStatementRun.findFirst({
      where: { tenantId, requestId },
      select: { status: true, resultJson: true, transactionCount: true },
    });
    if (!run) {
      throw new DomainException(
        'BANK_STATEMENT_RUN_NOT_FOUND',
        'No existe ese extracto.',
        HttpStatus.NOT_FOUND,
      );
    }
    const sinNada = run.resultJson === null || !run.transactionCount;
    if (!REABRIBLES.includes(run.status) || !sinNada) {
      throw new DomainException(
        'BANK_STATEMENT_RUN_NOT_REPROCESSABLE',
        'Sólo se vuelve a analizar una ejecución cerrada que no dejó resultado ni movimientos. ' +
          'Los casos en revisión se reprocesan desde su bandeja.',
        HttpStatus.CONFLICT,
        { status: run.status },
      );
    }
    const assigned = institutionCode?.trim()
      ? await this.assertKnownInstitution(tenantId, institutionCode)
      : undefined;
    if (!(await this.documents.ensureWorkingCopy(tenantId, requestId))) {
      throw new DomainException(
        'BANK_STATEMENT_DOCUMENT_UNAVAILABLE',
        'El documento original ya no está guardado: hay que volver a subirlo.',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.bankStatementRun.update({
        where: { tenantId_requestId: { tenantId, requestId } },
        data: requeueFields(principal, assigned),
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'BANK_STATEMENT_RUN_REPROCESSED',
          aggregateType: 'BankStatementRun',
          aggregateId: requestId,
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            requestId,
            previousStatus: run.status,
            ...(assigned ? { assignedInstitutionCode: assigned } : {}),
          },
        },
        tx,
      );
      await this.jobSignal.notify(tx, JobName.BankStatement);
    });
    return { requestId, status: WorkerRunStatus.QUEUED };
  }

  /**
   * La entidad tiene que existir: en el padrón del entorno o, si el padrón está vacío o incompleto, en
   * la nómina compilada de ASFI. Un código inventado no se guarda, porque el motor lo ignoraría y el
   * caso volvería a la cola con el mismo motivo sin que nadie supiera por qué.
   */
  async assertKnownInstitution(tenantId: bigint, raw: string): Promise<string> {
    const code = raw.trim().toUpperCase();
    const enPadron = await this.prisma.financialInstitution.findFirst({
      where: { tenantId, code },
      select: { code: true },
    });
    if (enPadron || BOLIVIA_INSTITUTIONS.some((item) => item.code.toUpperCase() === code))
      return code;
    throw new DomainException(
      'BANK_STATEMENT_INSTITUTION_UNKNOWN',
      `No hay ninguna entidad con el código ${code} en el padrón ni en la nómina de ASFI.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
