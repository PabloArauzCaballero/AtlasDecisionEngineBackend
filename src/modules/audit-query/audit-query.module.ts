import { Module } from '@nestjs/common';
import { AuditQueryController } from './audit-query.controller';
import { AuditQueryService } from './audit-query.service';

@Module({
  controllers: [AuditQueryController],
  providers: [AuditQueryService],
  exports: [AuditQueryService],
})
export class AuditQueryModule {}
