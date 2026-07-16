import { Module } from '@nestjs/common';
import { TraceabilityController } from './traceability.controller';
import { TraceabilityService } from './traceability.service';

@Module({
  controllers: [TraceabilityController],
  providers: [TraceabilityService],
  exports: [TraceabilityService],
})
export class TraceabilityModule {}
