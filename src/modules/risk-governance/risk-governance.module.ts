/**
 * Gobierno del riesgo (olas 4 a 6 del plan de microcrédito).
 *
 * Reúne tres cosas que comparten un rasgo: ninguna decide, todas condicionan lo que se puede
 * decidir. El apetito de cartera dice cuánto queda; la licitud vigente, qué datos se pueden usar
 * hoy sobre esta persona; el expediente, si el modelo sigue estando validado.
 *
 * Módulo aparte de `model-monitoring` aunque compartan la tabla de evaluaciones: aquél mide cómo
 * se comporta el modelo, éste fija las condiciones bajo las que se le deja operar.
 */
import { Module } from '@nestjs/common';
import { CalibrationService } from './calibration.service';
import { DecisionGuardService } from './decision-guard.service';
import { RiskGovernanceController } from './risk-governance.controller';
import { RiskGovernanceService } from './risk-governance.service';

@Module({
  controllers: [RiskGovernanceController],
  providers: [RiskGovernanceService, CalibrationService, DecisionGuardService],
  exports: [RiskGovernanceService, CalibrationService, DecisionGuardService],
})
export class RiskGovernanceModule {}
