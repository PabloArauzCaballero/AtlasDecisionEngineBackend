/** Composes approval persistence, blocking test evidence and version transitions. */
import { Module } from '@nestjs/common';
import { EventsModule } from '../../common/events/events.module';
import { ArtifactModule } from '../artifacts/artifact.module';
import { SecurityReviewModule } from '../security-review/security-review.module';
import { TestingModule } from '../testing/testing.module';
import { GovernanceController } from './governance.controller';
import { ApprovalDecisionGuard } from './approval-decision.guard';
import { ApprovalDecisionService } from './approval-decision.service';
import { ApprovalQueryService } from './approval-query.service';
import { ApprovalSubmissionService } from './approval-submission.service';
import { VersionApprovalGate } from './version-approval-gate';

@Module({
  imports: [ArtifactModule, TestingModule, EventsModule, SecurityReviewModule],
  controllers: [GovernanceController],
  providers: [
    ApprovalQueryService,
    ApprovalSubmissionService,
    ApprovalDecisionGuard,
    ApprovalDecisionService,
    VersionApprovalGate,
  ],
  exports: [VersionApprovalGate],
})
export class GovernanceModule {}
