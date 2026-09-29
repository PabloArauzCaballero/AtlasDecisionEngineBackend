/**
 * Adjunta el expediente del alta al caso de revisión de una ejecución, abriéndolo si hace falta.
 *
 * El alta del cliente pasa por UNA ejecución del Motor (artefacto de identidad, cola `IDENTIDAD`),
 * y el caso sólo nace si el artefacto termina en revisión humana. Con la revisión humana
 * obligatoria de AtlasBackend eso deja fuera justo los casos que más importan: cuando el Motor dice
 * VERIFICADO o RECHAZADO no hay caso aquí, y quien tiene que decidir no ve nada —ni el cronómetro
 * del alta, ni el dispositivo, ni la ubicación, ni lo declarado frente al carnet—.
 *
 * Esta ruta cierra ese hueco sin tocar la invariante de `ExecutionWriterService` (revisión ⇔ caso
 * AL ESCRIBIR la ejecución): el caso que se abre aquí es posterior y explícito, lo pide quien tiene
 * la política —AtlasBackend— y queda auditado como tal. Al resolverse sigue el camino de siempre:
 * `ManualReviewService.resolve` avisa por la cola, y en `IDENTIDAD` eso es el callback de identidad
 * con el `executionId` de este caso.
 */
import { HttpStatus, Injectable } from '@nestjs/common';
import { ManualReviewStatus, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { manualReviewCaseCode } from '../runtime/manual-review-case-code';
import type { AttachOnboardingDossierDto } from './onboarding-dossier.dto';

/** Tope del expediente serializado. Holgado para el contrato v1 (unos pocos KB) y lejos del de la API. */
export const MAX_DOSSIER_BYTES = 256 * 1024;

/** Lo que abre un caso por esta ruta si quien llama no dice otra cosa: el artefacto de identidad. */
export const DOSSIER_CASE_DEFAULTS = {
  queueCode: 'IDENTIDAD',
  priority: 50,
  slaMinutes: 240,
  motivo: 'REVISION_HUMANA_OBLIGATORIA',
} as const;

const CLOSED_STATUSES: readonly ManualReviewStatus[] = [
  ManualReviewStatus.RESOLVED_APPROVED,
  ManualReviewStatus.RESOLVED_DECLINED,
  ManualReviewStatus.CANCELLED,
];

type CaseRow = Prisma.DecisionManualReviewCaseGetPayload<object>;

function asObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class OnboardingDossierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async attach(
    tenantId: bigint,
    executionId: bigint,
    dto: AttachOnboardingDossierDto,
    principal: AuthenticatedPrincipal,
  ): Promise<CaseRow & { created: boolean }> {
    const bytes = Buffer.byteLength(JSON.stringify(dto.dossier ?? {}), 'utf8');
    if (bytes > MAX_DOSSIER_BYTES) {
      throw new DomainException(
        'ONBOARDING_DOSSIER_TOO_LARGE',
        `The onboarding dossier is ${bytes} bytes; the limit is ${MAX_DOSSIER_BYTES}`,
        HttpStatus.PAYLOAD_TOO_LARGE,
        { bytes, limit: MAX_DOSSIER_BYTES },
      );
    }
    try {
      return await this.attachOnce(tenantId, executionId, dto, principal);
    } catch (error) {
      /*
       * Dos envíos simultáneos para la misma ejecución compiten por `execution_id` (único): el que
       * pierde recibe P2002 al crear. Repetir ya encuentra el caso y sólo adjunta, que es lo que
       * habría hecho de haber llegado segundo. Una vez basta: el caso ya existe.
       */
      if (!isUniqueViolation(error)) throw error;
      return this.attachOnce(tenantId, executionId, dto, principal);
    }
  }

  private async attachOnce(
    tenantId: bigint,
    executionId: bigint,
    dto: AttachOnboardingDossierDto,
    principal: AuthenticatedPrincipal,
  ): Promise<CaseRow & { created: boolean }> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      // La ejecución tiene que ser de este tenant; si no, 404 igual que si no existiera.
      const execution = await tx.decisionExecution.findFirst({
        where: { id: executionId, tenantId },
        select: { id: true },
      });
      if (!execution) {
        throw new DomainException(
          'EXECUTION_NOT_FOUND',
          'Decision execution not found',
          HttpStatus.NOT_FOUND,
        );
      }
      const existing = await tx.decisionManualReviewCase.findFirst({
        where: { executionId, tenantId },
      });

      if (existing) {
        /*
         * Un caso cerrado no se reescribe: lo que el revisor vio al decidir es parte de la
         * evidencia de esa decisión, y cambiárselo después la falsea.
         */
        if (CLOSED_STATUSES.includes(existing.status)) {
          throw new DomainException(
            'MANUAL_REVIEW_CLOSED',
            'Manual review case is already closed; its evidence can no longer change',
            HttpStatus.CONFLICT,
            { caseCode: existing.caseCode, status: existing.status },
          );
        }
        const updated = await tx.decisionManualReviewCase.update({
          where: { id: existing.id },
          // Sólo la evidencia: estado, asignación, prioridad y plazo son de quien revisa.
          data: {
            evidenceJson: {
              ...asObject(existing.evidenceJson),
              alta: dto.dossier,
              altaActualizadaEn: now.toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
        await this.audit.append(
          {
            tenantId,
            eventType: 'MANUAL_REVIEW_DOSSIER_ATTACHED',
            aggregateType: 'ManualReviewCase',
            aggregateId: existing.id.toString(),
            actorId: principal.id,
            requestId: principal.requestId,
            payload: { executionId: executionId.toString(), created: false },
          },
          tx,
        );
        return { ...updated, created: false };
      }

      if (!dto.openIfMissing) {
        throw new DomainException(
          'MANUAL_REVIEW_NOT_FOUND',
          'This execution has no manual review case; send openIfMissing to open one',
          HttpStatus.NOT_FOUND,
        );
      }
      const open = dto.openIfMissing;
      const queueCode = open.queueCode ?? DOSSIER_CASE_DEFAULTS.queueCode;
      const slaMinutes = open.slaMinutes ?? DOSSIER_CASE_DEFAULTS.slaMinutes;
      const motivo = open.motivo ?? DOSSIER_CASE_DEFAULTS.motivo;
      const created = await tx.decisionManualReviewCase.create({
        data: {
          executionId,
          tenantId,
          caseCode: manualReviewCaseCode(executionId),
          queueCode,
          priority: open.priority ?? DOSSIER_CASE_DEFAULTS.priority,
          status: ManualReviewStatus.OPEN,
          dueAt: new Date(now.getTime() + slaMinutes * 60_000),
          evidenceJson: {
            motivo,
            alta: dto.dossier,
            altaActualizadaEn: now.toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
      await this.audit.append(
        {
          tenantId,
          eventType: 'MANUAL_REVIEW_OPENED',
          aggregateType: 'ManualReviewCase',
          aggregateId: created.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            executionId: executionId.toString(),
            queueCode,
            motivo,
            source: 'ONBOARDING_DOSSIER',
          },
        },
        tx,
      );
      return { ...created, created: true };
    });
  }
}
