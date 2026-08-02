/** Exposes security review as a read model over existing sources of truth. */
import { Module } from '@nestjs/common';
import { SecurityReviewController } from './security-review.controller';
import { SecurityReviewService } from './security-review.service';

@Module({
  controllers: [SecurityReviewController],
  providers: [SecurityReviewService],
  exports: [SecurityReviewService],
})
export class SecurityReviewModule {}
