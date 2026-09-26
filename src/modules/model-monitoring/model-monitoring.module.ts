/** Monitoreo continuo del modelo desplegado (SR 11-7 §V; CMN 4.557 art. 40). */
import { Module } from '@nestjs/common';
import { EventsModule } from '../../common/events/events.module';
import { BaselineCaptureService } from './baseline-capture.service';
import { CutoffAnalysisService } from './cutoff-analysis.service';
import { DecisionCoverageService } from './decision-coverage.service';
import { MonitoringEvaluatorService } from './monitoring-evaluator.service';
import { ModelMonitoringController } from './model-monitoring.controller';
import { ModelMonitoringService } from './model-monitoring.service';

@Module({
  // `EventsModule` no es global: el evaluador publica el aviso de `BREACH` por el outbox
  // transaccional que ya alimenta las notificaciones, en vez de estrenar un canal propio que
  // pudiera callarse sin que nadie lo note.
  imports: [EventsModule],
  controllers: [ModelMonitoringController],
  providers: [
    ModelMonitoringService,
    DecisionCoverageService,
    MonitoringEvaluatorService,
    BaselineCaptureService,
    CutoffAnalysisService,
  ],
  exports: [
    ModelMonitoringService,
    DecisionCoverageService,
    MonitoringEvaluatorService,
    BaselineCaptureService,
    CutoffAnalysisService,
  ],
})
export class ModelMonitoringModule {}
