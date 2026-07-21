import { Module } from '@nestjs/common';
import { SecurityReviewController } from './security-review.controller';
import { SecurityReviewService } from './security-review.service';

@Module({
  controllers: [SecurityReviewController],
  providers: [SecurityReviewService],
  exports: [SecurityReviewService],
})
export class SecurityReviewModule {}
