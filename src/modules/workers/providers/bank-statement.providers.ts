import { BankStatementRunWorkerService } from '../bank-statement/bank-statement-run-worker.service';
import { StatementFileStore } from '../bank-statement/statement-file-store.service';
import { StatementRunIntakeService } from '../bank-statement/statement-run-intake.service';
import { StatementRunService } from '../bank-statement/statement-run.service';
import { StatementUploadPolicy } from '../bank-statement/statement-upload.policy';
import { InstitutionLogoService } from '../bank-statement/institutions/institution-logo.service';
import { InstitutionRegistryService } from '../bank-statement/institutions/institution-registry.service';
import { InstitutionCatalogService } from '../bank-statement/institutions/institution-catalog.service';
import { StatementReprocessService } from '../bank-statement/review/statement-reprocess.service';
import { StatementReviewAssignment } from '../bank-statement/review/statement-review-assignment.service';
import { StatementReviewClaimService } from '../bank-statement/review/statement-review-claim.service';
import { StatementReviewDocuments } from '../bank-statement/review/statement-review-documents.service';
import { StatementReviewQueueService } from '../bank-statement/review/statement-review-queue.service';
import { StatementReviewResolutionService } from '../bank-statement/review/statement-review-resolution.service';

export const BANK_STATEMENT_PROVIDERS = [
  // El padrón de entidades: la tabla que decide a quién se atribuye un
  // extracto. El catálogo va antes que el CRUD porque éste lo invalida en cada
  // escritura, y antes que el worker porque el motor lo lee en cada documento.
  InstitutionCatalogService,
  InstitutionRegistryService,
  InstitutionLogoService,
  // --- Worker B: extractos bancarios -------------------------------------
  StatementFileStore,
  StatementRunIntakeService,
  StatementRunService,
  StatementUploadPolicy,
  BankStatementRunWorkerService,
  // La cola de revisión humana. Servicio aparte del de ejecuciones porque
  // responde a otra pregunta y la contesta con otras reglas: quién puede
  // resolver, en qué orden se trabaja y qué queda en la auditoría.
  StatementReviewDocuments,
  StatementReviewQueueService,
  StatementReviewAssignment,
  StatementReviewClaimService,
  StatementReviewResolutionService,
  StatementReprocessService,
];
