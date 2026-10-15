import { ConfigService } from '@nestjs/config';
import type { AuditService } from '../../src/common/audit/audit.service';
import type { OutboxPublisherService } from '../../src/common/events/outbox-publisher.service';
import type { PrismaService } from '../../src/common/prisma/prisma.service';
import type { VersionStateService } from '../../src/modules/artifacts/version-state.service';
import { ApprovalDecisionGuard } from '../../src/modules/governance/approval-decision.guard';
import { ApprovalDecisionService } from '../../src/modules/governance/approval-decision.service';
import { ApprovalQueryService } from '../../src/modules/governance/approval-query.service';
import { ApprovalSubmissionService } from '../../src/modules/governance/approval-submission.service';
import { VersionApprovalGate } from '../../src/modules/governance/version-approval-gate';
import type { SecurityReviewService } from '../../src/modules/security-review/security-review.service';
import type { TestExecutionService } from '../../src/modules/testing/test-execution.service';

/** Los cuatro servicios de gobierno armados con las mismas dependencias, como los cablea el módulo. */
export function buildGovernance(
  prisma: PrismaService,
  tests: TestExecutionService,
  states: VersionStateService,
  audit: AuditService,
  outbox: OutboxPublisherService,
  securityReview: SecurityReviewService,
  config: ConfigService,
) {
  return {
    queries: new ApprovalQueryService(prisma, config),
    gate: new VersionApprovalGate(prisma),
    submissions: new ApprovalSubmissionService(
      prisma,
      tests,
      states,
      audit,
      outbox,
      securityReview,
    ),
    decisions: new ApprovalDecisionService(
      prisma,
      states,
      audit,
      outbox,
      new ApprovalDecisionGuard(prisma, config),
    ),
  };
}
