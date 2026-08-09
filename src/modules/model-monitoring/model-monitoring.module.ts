/** Monitoreo continuo del modelo desplegado (SR 11-7 §V; CMN 4.557 art. 40). */
import { Module } from '@nestjs/common';
import { ModelMonitoringController } from './model-monitoring.controller';
import { ModelMonitoringService } from './model-monitoring.service';

@Module({
  controllers: [ModelMonitoringController],
  providers: [ModelMonitoringService],
  exports: [ModelMonitoringService],
})
export class ModelMonitoringModule {}
