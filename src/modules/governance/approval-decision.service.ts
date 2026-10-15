import { Injectable } from '@nestjs/common';
import {
  ApprovalOutcome,
  ApprovalRequestStatus,
  ApprovalStepStatus,
  Prisma,
  VersionStatus,
} from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { DecisionEventType } from '../../common/events/event-types';
import { OutboxPublisherService } from '../../common/events/outbox-publisher.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { VersionStateService } from '../artifacts/version-state.service';
import { ApprovalDecisionGuard } from './approval-decision.guard';
import { RecordApprovalDecisionDto } from './governance.dto';

@Injectable()
export class ApprovalDecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly states: VersionStateService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxPublisherService,
    private readonly guard: ApprovalDecisionGuard,
  ) {}

  async recordDecision(
    tenantId: bigint,
    stepId: bigint,
    dto: RecordApprovalDecisionDto,
    principal: AuthenticatedPrincipal,
  ) {
    const { step, signedByAdminWildcard } = await this.guard.authorize(tenantId, stepId, principal);

    const outcome = dto.decision as ApprovalOutcome;
    const reviewedVersion = step.approvalRequest.artifactVersion;
    // Shared v1 payload for the review-outcome events; the author is who gets notified.
    const outcomeEvent = {
      tenantId,
      aggregateType: 'ApprovalRequest',
      aggregateId: step.approvalRequestId.toString(),
      actorId: principal.id,
      correlationId: principal.requestId,
      payload: {
        versionId: reviewedVersion.id.toString(),
        approvalRequestId: step.approvalRequestId.toString(),
        artifactCode: reviewedVersion.artifact.artifactCode,
        versionNumber: reviewedVersion.versionNumber,
        authorId: reviewedVersion.createdBy,
        decidedBy: principal.id,
        comments: dto.comments,
      },
    };
    const result = await this.prisma.$transaction(async (tx) => {
      const decision = await tx.decisionApprovalDecision.create({
        data: {
          approvalStepId: stepId,
          decidedBy: principal.id,
          decision: outcome,
          comments: dto.comments,
          evidence: {
            create: dto.evidence.map((item) => ({
              evidenceType: item.evidenceType,
              uri: item.uri,
              checksum: item.checksum,
              metadataJson: item.metadata as Prisma.InputJsonValue | undefined,
            })),
          },
        },
        include: { evidence: true },
      });

      if (outcome === ApprovalOutcome.REQUEST_CHANGES) {
        await tx.decisionApprovalStep.update({
          where: { id: stepId },
          data: { status: ApprovalStepStatus.CHANGES_REQUESTED },
        });
        await tx.decisionApprovalRequest.update({
          where: { id: step.approvalRequestId },
          data: { status: ApprovalRequestStatus.CHANGES_REQUESTED },
        });
        await this.states.transition(
          step.approvalRequest.artifactVersionId,
          VersionStatus.CHANGES_REQUESTED,
          principal.id,
          dto.comments,
          tx,
        );
        await this.outbox.publish(tx, {
          ...outcomeEvent,
          eventType: DecisionEventType.VERSION_CHANGES_REQUESTED,
        });
      } else if (outcome === ApprovalOutcome.REJECT) {
        await tx.decisionApprovalStep.update({
          where: { id: stepId },
          data: { status: ApprovalStepStatus.REJECTED },
        });
        await tx.decisionApprovalRequest.update({
          where: { id: step.approvalRequestId },
          data: { status: ApprovalRequestStatus.REJECTED },
        });
        await this.states.transition(
          step.approvalRequest.artifactVersionId,
          VersionStatus.REJECTED,
          principal.id,
          dto.comments,
          tx,
        );
        await this.outbox.publish(tx, {
          ...outcomeEvent,
          eventType: DecisionEventType.VERSION_REJECTED,
        });
      } else {
        const approvals =
          step.decisions.filter((item) => item.decision === ApprovalOutcome.APPROVE).length + 1;
        if (approvals >= step.minApprovals) {
          await tx.decisionApprovalStep.update({
            where: { id: stepId },
            data: { status: ApprovalStepStatus.APPROVED },
          });
        }
        const remaining = await tx.decisionApprovalStep.count({
          where: {
            approvalRequestId: step.approvalRequestId,
            id: { not: stepId },
            status: { not: ApprovalStepStatus.APPROVED },
          },
        });
        const currentApproved = approvals >= step.minApprovals;
        if (remaining === 0 && currentApproved) {
          await tx.decisionApprovalRequest.update({
            where: { id: step.approvalRequestId },
            data: { status: ApprovalRequestStatus.APPROVED },
          });
          await this.states.transition(
            step.approvalRequest.artifactVersionId,
            VersionStatus.APPROVED,
            principal.id,
            'All required approval steps completed',
            tx,
          );
          // Published only when the LAST step approves: the author is told the version is
          // fully approved, not that one intermediate vote landed.
          await this.outbox.publish(tx, {
            ...outcomeEvent,
            eventType: DecisionEventType.VERSION_APPROVED,
          });
        }
      }

      // Inside the transaction: an approval that commits without its audit event would be
      // an unevidenced decision, and an audit event that survives a rolled-back approval
      // would attest to something that never happened.
      await this.audit.append(
        {
          tenantId,
          eventType: `APPROVAL_${dto.decision}`,
          aggregateType: 'ApprovalRequest',
          aggregateId: step.approvalRequestId.toString(),
          actorId: principal.id,
          requestId: principal.requestId,
          payload: {
            stepId: stepId.toString(),
            requiredRole: step.requiredRole,
            decision: dto.decision,
            evidenceCount: dto.evidence.length,
            // Segregación de funciones (ISO 27002 5.3): una firma que no salió del rol del
            // paso sino del comodín de PLATFORM_ADMIN tiene que poder encontrarse después.
            signedVia: signedByAdminWildcard ? 'PLATFORM_ADMIN_WILDCARD' : 'REQUIRED_ROLE',
          },
        },
        tx,
      );
      return decision;
    });

    return result;
  }
}
