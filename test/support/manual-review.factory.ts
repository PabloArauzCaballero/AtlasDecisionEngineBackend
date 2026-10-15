import type { ConfigService } from '@nestjs/config';
import type { AuditService } from '../../src/common/audit/audit.service';
import type { PrismaService } from '../../src/common/prisma/prisma.service';
import type { AtlasCallbackService } from '../../src/modules/atlas-callback/atlas-callback.service';
import { ManualReviewAssignmentService } from '../../src/modules/manual-review/manual-review-assignment.service';
import { ManualReviewQueryService } from '../../src/modules/manual-review/manual-review-query.service';
import { ManualReviewResolutionService } from '../../src/modules/manual-review/manual-review-resolution.service';

/** Los tres servicios de revisión manual armados con las mismas dependencias, como los cablea el módulo. */
export function buildManualReview(
  prisma: PrismaService,
  audit: AuditService,
  config: ConfigService,
  callbacks: AtlasCallbackService,
) {
  return {
    queries: new ManualReviewQueryService(prisma, config),
    assignments: new ManualReviewAssignmentService(prisma, audit),
    resolutions: new ManualReviewResolutionService(prisma, audit, callbacks),
  };
}
