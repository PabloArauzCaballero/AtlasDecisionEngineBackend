/** Monitoreo continuo del modelo desplegado (SR 11-7 §V; CMN 4.557 art. 40). */
import { Module } from '@nestjs/common';
import { EventsModule } from '../../common/events/events.module';
import { BaselineCaptureService } from './baseline-capture.service';
import { CutoffAnalysisService } from './cutoff-analysis.service';
import { DecisionCoverageService } from './decision-coverage.service';
import { MonitoringEvaluationWriter } from './monitoring-evaluation-writer';
import { MonitoringEvaluatorService } from './monitoring-evaluator.service';
import { OperationalMeasurements } from './operational-measurements';
import { PopulationMeasurements } from './population-measurements';
import { ModelMonitoringController } from './model-monitoring.controller';
import { ModelMonitoringIngestService } from './model-monitoring-ingest.service';
import { ModelMonitoringQueryService } from './model-monitoring-query.service';

@Module({
  // `EventsModule` no es global: el evaluador publica el aviso de `BREACH` por el outbox
  // transaccional que ya alimenta las notificaciones, en vez de estrenar un canal propio que
  // pudiera callarse sin que nadie lo note.
  imports: [EventsModule],
  controllers: [ModelMonitoringController],
  providers: [
    ModelMonitoringIngestService,
    ModelMonitoringQueryService,
    DecisionCoverageService,
    PopulationMeasurements,
    OperationalMeasurements,
    MonitoringEvaluationWriter,
    MonitoringEvaluatorService,
    BaselineCaptureService,
    CutoffAnalysisService,
  ],
  exports: [
    ModelMonitoringIngestService,
    ModelMonitoringQueryService,
    DecisionCoverageService,
    MonitoringEvaluatorService,
    BaselineCaptureService,
    CutoffAnalysisService,
  ],
})
export class ModelMonitoringModule {}
