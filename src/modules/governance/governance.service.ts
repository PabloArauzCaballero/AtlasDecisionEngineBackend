import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { DomainException } from '../../common/errors/domain-exception';
import { pageResult, paginationArgs } from '../../common/http/pagination';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PlatformRole } from '../../common/security/platform-roles';
import type { AuthenticatedPrincipal } from '../../common/security/security.types';
import { VersionStateService } from '../artifacts/version-state.service';
import { TestExecutionService } from '../testing/test-execution.service';
import {
  ApprovalRequestListQueryDto,
  RecordApprovalDecisionDto,
  SubmitReviewDto,
} from './governance.dto';

@Injectable()
export class GovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tests: TestExecutionService,
    private readonly states: VersionStateService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxPublisherService,
    private readonly config: ConfigService,
  ) {}

  async listRequests(tenantId: bigint, query: ApprovalRequestListQueryDto) {
    const { skip, take, page, pageSize } = paginationArgs(
      query,
      this.config.get<number>('MAX_PAGE_SIZE') ?? 100,
    );
    const where = { artifactVersion: { artifact: { tenantId } } };
    const [requests, total] = await this.prisma.$transaction([
      this.prisma.decisionApprovalRequest.findMany({
        where,
        include: {
          artifactVersion: { include: { artifact: true } },
          steps: { orderBy: { stepOrder: 'asc' } },
        },
        orderBy: { requestedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.decisionApprovalRequest.count({ where }),
    ]);
    const items = requests.map((request) => {
      const currentStep = request.steps.find((step) => step.status === 'PENDING');
      const overdue = Boolean(
        request.dueAt && request.dueAt.getTime() < Date.now() && request.status === 'IN_REVIEW',
      );
      return {
        ...request,
        artifactCode: request.artifactVersion.artifact.artifactCode,
        versionNumber: request.artifactVersion.versionNumber,
        createdAt: request.requestedAt,
        currentStep: currentStep?.requiredRole ?? request.status,
        slaStatus: overdue ? 'OVERDUE' : 'ON_TRACK',
      };
    });
    return pageResult(items, total, page, pageSize);
  }

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

    const steps = [
      {
        stepOrder: 1,
        requiredRole: PlatformRole.QA_ANALYST,
        minApprovals: 1,
        separationOfDuties: true,
      },
      {
        stepOrder: 2,
        requiredRole: PlatformRole.RISK_APPROVER,
        minApprovals: 1,
        separationOfDuties: true,
      },
      ...(dto.requireCompliance
        ? [
            {
              stepOrder: 3,
              requiredRole: PlatformRole.COMPLIANCE,
              minApprovals: 1,
              separationOfDuties: true,
            },
          ]
        : []),
    ];
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
      return created;
    });
    return request;
  }

  async recordDecision(
    tenantId: bigint,
    stepId: bigint,
    dto: RecordApprovalDecisionDto,
    principal: AuthenticatedPrincipal,
  ) {
    const step = await this.prisma.decisionApprovalStep.findFirst({
      where: {
        id: stepId,
        approvalRequest: { artifactVersion: { artifact: { tenantId } } },
      },
      include: {
        approvalRequest: {
          include: {
            artifactVersion: { include: { artifact: true } },
            steps: {
              include: { decisions: true },
              orderBy: { stepOrder: 'asc' },
            },
          },
        },
        decisions: true,
      },
    });
    if (!step)
      throw new DomainException(
        'APPROVAL_STEP_NOT_FOUND',
        'Approval step not found',
        HttpStatus.NOT_FOUND,
      );
    if (
      step.approvalRequest.status !== ApprovalRequestStatus.IN_REVIEW ||
      step.status !== ApprovalStepStatus.PENDING
    ) {
      throw new DomainException(
        'APPROVAL_STEP_CLOSED',
        'Approval step is no longer open',
        HttpStatus.CONFLICT,
      );
    }
    const priorIncomplete = step.approvalRequest.steps.some(
      (candidate) =>
        candidate.stepOrder < step.stepOrder && candidate.status !== ApprovalStepStatus.APPROVED,
    );
    if (priorIncomplete) {
      throw new DomainException(
        'APPROVAL_STEP_OUT_OF_ORDER',
        'Previous approval steps must complete first',
        HttpStatus.CONFLICT,
      );
    }
    if (
      !principal.roles.includes(step.requiredRole) &&
      !principal.roles.includes(PlatformRole.PLATFORM_ADMIN)
    ) {
      throw new DomainException(
        'APPROVAL_ROLE_REQUIRED',
        `Role ${step.requiredRole} is required`,
        HttpStatus.FORBIDDEN,
      );
    }
    if (
      step.separationOfDuties &&
      step.approvalRequest.artifactVersion.createdBy === principal.id
    ) {
      throw new DomainException(
        'SEPARATION_OF_DUTIES_VIOLATION',
        'The version author cannot approve the same version',
        HttpStatus.FORBIDDEN,
      );
    }
    if (step.decisions.some((decision) => decision.decidedBy === principal.id)) {
      throw new DomainException(
        'DUPLICATE_APPROVAL_DECISION',
        'This principal already decided this step',
        HttpStatus.CONFLICT,
      );
    }

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
        comments: dto.comments ?? null,
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
          dto.comments ?? 'Changes requested',
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
          dto.comments ?? 'Rejected',
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
          },
        },
        tx,
      );
      return decision;
    });

    return result;
  }

  async getRequest(tenantId: bigint, requestId: bigint) {
    const request = await this.prisma.decisionApprovalRequest.findFirst({
      where: { id: requestId, artifactVersion: { artifact: { tenantId } } },
      include: {
        artifactVersion: { include: { artifact: true } },
        steps: {
          orderBy: { stepOrder: 'asc' },
          include: {
            decisions: {
              include: { evidence: true },
              orderBy: { decidedAt: 'asc' },
            },
          },
        },
      },
    });
    if (!request)
      throw new DomainException(
        'APPROVAL_REQUEST_NOT_FOUND',
        'Approval request not found',
        HttpStatus.NOT_FOUND,
      );
    return request;
  }

  async assertApproved(tenantId: bigint, versionId: bigint): Promise<void> {
    const version = await this.prisma.decisionArtifactVersion.findFirst({
      where: { id: versionId, artifact: { tenantId } },
      select: { status: true, approvedAt: true },
    });
    const approvedStatuses: VersionStatus[] = [
      VersionStatus.APPROVED,
      VersionStatus.DEPLOYED_TO_SANDBOX,
      VersionStatus.DEPLOYED_TO_TEST,
      VersionStatus.DEPLOYED_TO_PROD,
    ];
    if (!version || !approvedStatuses.includes(version.status)) {
      throw new DomainException(
        'VERSION_NOT_APPROVED',
        'Version is not fully approved',
        HttpStatus.CONFLICT,
      );
    }
  }
}
