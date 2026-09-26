/**
 * La tubería del desenlace.
 *
 * Módulo aparte de `model-monitoring` aunque compartan tabla: aquel ANALIZA lo que hay, éste se
 * ocupa de que haya algo. Son dos ritmos distintos —el análisis lo pide una persona, la ingesta
 * la ejecuta la conciliación nocturna— y dos conjuntos de roles distintos.
 */
import { Module } from '@nestjs/common';
import { OutcomeIngestionController } from './outcome-ingestion.controller';
import { OutcomeIngestionService } from './outcome-ingestion.service';
import { VintageService } from './vintage.service';

@Module({
  controllers: [OutcomeIngestionController],
  providers: [OutcomeIngestionService, VintageService],
  exports: [OutcomeIngestionService, VintageService],
})
export class OutcomeIngestionModule {}
