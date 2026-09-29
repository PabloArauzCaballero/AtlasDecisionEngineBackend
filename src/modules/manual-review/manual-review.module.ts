/** Publishes human-review operations while reusing global audit and security controls. */
import { Module } from '@nestjs/common';
import { AtlasCallbackModule } from '../atlas-callback/atlas-callback.module';
import { ManualReviewController } from './manual-review.controller';
import { ManualReviewService } from './manual-review.service';
import { OnboardingDossierController } from './onboarding-dossier.controller';
import { OnboardingDossierService } from './onboarding-dossier.service';

@Module({
  imports: [AtlasCallbackModule],
  controllers: [ManualReviewController, OnboardingDossierController],
  providers: [ManualReviewService, OnboardingDossierService],
  exports: [ManualReviewService],
})
export class ManualReviewModule {}
