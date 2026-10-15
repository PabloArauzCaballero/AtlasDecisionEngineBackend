/** Publishes human-review operations while reusing global audit and security controls. */
import { Module } from '@nestjs/common';
import { AtlasCallbackModule } from '../atlas-callback/atlas-callback.module';
import { ManualReviewController } from './manual-review.controller';
import { ManualReviewAssignmentService } from './manual-review-assignment.service';
import { ManualReviewQueryService } from './manual-review-query.service';
import { ManualReviewResolutionService } from './manual-review-resolution.service';
import { OnboardingDossierController } from './onboarding-dossier.controller';
import { OnboardingDossierService } from './onboarding-dossier.service';

@Module({
  imports: [AtlasCallbackModule],
  controllers: [ManualReviewController, OnboardingDossierController],
  providers: [
    ManualReviewQueryService,
    ManualReviewAssignmentService,
    ManualReviewResolutionService,
    OnboardingDossierService,
  ],
})
export class ManualReviewModule {}
