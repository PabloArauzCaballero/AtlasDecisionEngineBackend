import { ImageQualityAssessmentService } from '../identity-verification/core/image-quality-assessment.service';
import { BoliviaCiDocumentParser } from '../identity-verification/core/parsers/bolivia-ci-document.parser';
import {
  GenericDocumentParser,
  PassportDocumentParser,
} from '../identity-verification/core/parsers/document-parser';
import { DocumentParserRegistry } from '../identity-verification/core/parsers/document-parser.registry';
import { IdentityPipelineService } from '../identity-verification/identity-pipeline.service';
import { DocumentAuthenticityService } from '../identity-verification/pipeline/document-authenticity.service';
import { DocumentFieldsService } from '../identity-verification/pipeline/document-fields.service';
import { DocumentGateService } from '../identity-verification/pipeline/document-gate.service';
import { DocumentIntakeService } from '../identity-verification/pipeline/document-intake.service';
import { DocumentOrientationService } from '../identity-verification/pipeline/document-orientation.service';
import { DocumentTextReaderService } from '../identity-verification/pipeline/document-text-reader.service';
import { FaceCaptureService } from '../identity-verification/pipeline/face-capture.service';
import { IdentityReviewAssignment } from '../identity-verification/review/identity-review-assignment.service';
import { IdentityReviewClaimService } from '../identity-verification/review/identity-review-claim.service';
import { IdentityReviewQueueService } from '../identity-verification/review/identity-review-queue.service';
import { IdentityReviewResolutionService } from '../identity-verification/review/identity-review-resolution.service';
import { IdentityVerdictSigner } from '../identity-verification/review/identity-verdict-signer.service';
import { IdentityRunFailureService } from '../identity-verification/identity-run-failure.service';
import { IdentityRunLeaseService } from '../identity-verification/identity-run-lease.service';
import { IdentityRunWorkerService } from '../identity-verification/identity-run-worker.service';
import { IdentityDecisionPolicy } from '../identity-verification/identity-decision-policy.service';
import { IdentityImageStore } from '../identity-verification/identity-image-store.service';
import { IdentityRunIntakeService } from '../identity-verification/identity-run-intake.service';
import { IdentityRunService } from '../identity-verification/identity-run.service';

export const IDENTITY_VERIFICATION_PROVIDERS = [
  // --- Worker C: verificación de identidad --------------------------------
  IdentityImageStore,
  IdentityRunIntakeService,
  IdentityRunService,
  IdentityDecisionPolicy,
  IdentityRunLeaseService,
  IdentityRunFailureService,
  IdentityRunWorkerService,
  IdentityPipelineService,
  DocumentIntakeService,
  DocumentTextReaderService,
  DocumentOrientationService,
  DocumentGateService,
  DocumentFieldsService,
  DocumentAuthenticityService,
  FaceCaptureService,
  IdentityReviewQueueService,
  IdentityReviewClaimService,
  IdentityReviewAssignment,
  IdentityVerdictSigner,
  IdentityReviewResolutionService,
  // Núcleo absorbido: analizadores, medida de calidad y proveedores.
  BoliviaCiDocumentParser,
  PassportDocumentParser,
  GenericDocumentParser,
  DocumentParserRegistry,
  ImageQualityAssessmentService,
];
