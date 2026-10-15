import { HttpStatus, Injectable } from '@nestjs/common';
import { ApprovalRequestStatus, Prisma, VersionStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import {
  DecisionEventType,
  type SecurityRiskDetectedPayload,
} from '../../common/events/event-types';
import { OutboxPublisherService } from '../../common/events/outbox-publisher.service';
import { DomainException } from '../../common/errors/domain-exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { VersionStateService } from '../artifacts/version-state.service';
import {
  SecurityReviewService,
  type SecurityFinding,
} from '../security-review/security-review.service';
import { TestExecutionService } from '../testing/test-execution.service';
import { buildApprovalSteps } from './approval-steps';
import { SubmitReviewDto } from './governance.dto';

@Injectable()
export class ApprovalSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tests: TestExecutionService,
    private readonly states: VersionStateService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxPublisherService,
    private readonly securityReview: SecurityReviewService,
  ) {}

  async submitForReview(
    tenantId: bigint,
    versionId: bigint,
    dto: SubmitReviewDto,
    principal: AuthenticatedPrincipal,
  ) {
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: versionId, artifact: { tenantId } },
      include: {
        artifact: true,
        compiledArtifacts: {
          where: { compileStatus: 'SUCCESS' },
          orderBy: { compiledAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!version)
      throw new DomainException(
        'VERSION_NOT_FOUND',
        'Artifact version not found',
        HttpStatus.NOT_FOUND,
      );
    if (version.status !== VersionStatus.COMPILED || !version.compiledArtifacts.length) {
      throw new DomainException(
        'VERSION_NOT_REVIEWABLE',
        'Version must be COMPILED before review',
        HttpStatus.CONFLICT,
      );
    }
    const blocking = await this.tests.verifyBlockingTests(tenantId, versionId);
    if (!blocking.passed) {
      throw new DomainException(
        'BLOCKING_TESTS_NOT_PASSED',
        'Blocking tests and minimum coverage must pass before review',
        HttpStatus.CONFLICT,
        blocking.evidence,
      );
    }
    const active = await this.prisma.decisionApprovalRequest.findFirst({
      where: {
        artifactVersionId: versionId,
        status: ApprovalRequestStatus.IN_REVIEW,
      },
    });
    if (active)
      throw new DomainException(
        'APPROVAL_REQUEST_EXISTS',
        'An active approval request already exists',
        HttpStatus.CONFLICT,
      );

    const steps = buildApprovalSteps(dto.requireCompliance);
    /**
     * Revisión de seguridad de la versión que entra en revisión.
     *
     * Se calcula ANTES de abrir la transacción: son varias consultas y no tienen por qué
     * sostener un bloqueo. No decide nada —no bloquea el envío— porque su criterio ya está
     * fijado en `computeFindings` y aquí sólo se avisa a quien debe mirarlo antes de aprobar.
     *
     * El momento es éste y no la lectura del panel: `review()` es un GET y emitir desde ahí
     * dispararía un aviso por cada carga de página. El envío a revisión ocurre una vez, y es
     * cuando cumplimiento y fraude todavía pueden actuar.
     */
    const security = await this.securityReview
      .getVersionReview(tenantId, versionId)
      .catch(() => undefined);

    const request = await this.prisma.$transaction(async (tx) => {
      const created = await tx.decisionApprovalRequest.create({
        data: {
          artifactVersionId: versionId,
          workflowCode:
            dto.workflowCode ?? (dto.requireCompliance ? 'STANDARD_WITH_COMPLIANCE' : 'STANDARD'),
          requestedBy: principal.id,
          dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
          steps: { create: steps },
        },
        include: { steps: true },
      });
      await this.states.transition(
        versionId,
        VersionStatus.IN_REVIEW,
        principal.id,
        'Submitted for governed review',
        tx,
      );
      await this.audit.append(
        {
          tenantId,
          eventType: 'APPROVAL_REQUEST_CREATED',
          aggregateType: 'ApprovalRequest',
          aggregateId: created.id.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            versionId: versionId.toString(),
            workflowCode: created.workflowCode,
            blockingTestEvidence: blocking.evidence,
          } as unknown as Prisma.InputJsonValue,
        },
        tx,
      );
      // Same transaction as the state change: the review-requested event must not exist
      // without the request, nor the request without its event (outbox pattern).
      await this.outbox.publish(tx, {
        eventType: DecisionEventType.VERSION_SUBMITTED_FOR_REVIEW,
        tenantId,
        aggregateType: 'DecisionArtifactVersion',
        aggregateId: versionId.toString(),
        actorId: principal.id,
        correlationId: principal.requestId,
        payload: {
          versionId: versionId.toString(),
          approvalRequestId: created.id.toString(),
          artifactCode: version.artifact.artifactCode,
          versionNumber: version.versionNumber,
          workflowCode: created.workflowCode,
          authorId: version.createdBy,
          reviewerRoles: created.steps.map((step) => step.requiredRole),
        },
      });

      // Sólo el riesgo ALTO avisa. Un aviso por cada hallazgo menor entrenaría a quien lo
      // recibe a ignorarlos, que es peor que no mandarlos.
      if (security?.severity === 'HIGH') {
        await this.outbox.publish(tx, {
          eventType: DecisionEventType.SECURITY_RISK_DETECTED,
          tenantId,
          aggregateType: 'DecisionArtifactVersion',
          aggregateId: versionId.toString(),
          actorId: principal.id,
          correlationId: principal.requestId,
          payload: {
            versionId: versionId.toString(),
            artifactCode: version.artifact.artifactCode,
            versionNumber: version.versionNumber,
            approvalRequestId: created.id.toString(),
            severity: security.severity,
            // El resumen viaja al cuerpo de la notificación: lleva los códigos de hallazgo,
            // nunca el fuente revisado ni el valor de una variable sensible.
            summary:
              `${version.artifact.artifactCode} entró en revisión con riesgo ALTO: ` +
              security.findings
                .filter((finding: SecurityFinding) => finding.severity === 'HIGH')
                .map((finding: SecurityFinding) => finding.code)
                .join(', '),
            findingCodes: security.findings.map((finding: SecurityFinding) => finding.code),
          } satisfies SecurityRiskDetectedPayload,
        });
      }
      return created;
    });
    return request;
  }
}
