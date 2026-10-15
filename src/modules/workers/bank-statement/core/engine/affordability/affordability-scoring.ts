import type {
  AffordabilityBand,
  AffordabilityRiskSignals,
  CapacityAssessment,
  IncomeAssessment,
  ObligationAssessment,
} from './affordability-model';
import type { AffordabilityPolicy } from './affordability-policy';
import { clamp } from './statistics';

/**
 * Cinco dimensiones, y ninguna puede compensar del todo a otra.
 *
 * El puntaje NO es la respuesta —eso lo decide la política— sino una síntesis
 * comparable entre expedientes. Las cinco están porque cada una describe una
 * forma distinta de no poder pagar: sin margen (holgura), con margen que no se
 * sostiene (estabilidad), con margen ya prometido a otro (carga), con margen
 * mensual pero sin dinero el día del cobro (liquidez), y con todo lo anterior
 * bien y una forma de administrar la cuenta que dice lo contrario (conducta).
 */
export function computeScore(
  income: IncomeAssessment,
  obligations: ObligationAssessment,
  capacity: CapacityAssessment,
  signals: AffordabilityRiskSignals,
  policy: AffordabilityPolicy,
): number {
  const headroom =
    income.monthlyRecognized > 0 ? capacity.stressedDisposableIncome / income.monthlyRecognized : 0;
  // Un 35 % de holgura sobre el ingreso ya es un expediente holgado; por encima
  // deja de discriminar y el tramo se satura.
  const headroomScore = clamp(headroom / 0.35, 0, 1) * 100;
  const stabilityScore = income.stabilityScore;
  const burdenScore =
    clamp(1 - obligations.debtServiceRatio / policy.debtServiceToIncomeCap, 0, 1) * 100;
  const liquidityScore =
    signals.cashCushionDays === null
      ? 50
      : clamp(signals.cashCushionDays / policy.cashCushionTargetDays, 0, 1) * 100;

  const conductPenalty =
    Math.min(45, signals.nsfEvents * 15) +
    Math.min(30, signals.monthsEndingNegative * 10) +
    Math.min(30, signals.highRiskMonths * 10) +
    (signals.creditDisbursementsReceived > 0 && obligations.monthly > 0 ? 20 : 0) +
    (signals.collectionActions > 0 ? 25 : 0);
  const conductScore = clamp(100 - conductPenalty, 0, 100);

  const blended =
    headroomScore * 0.3 +
    stabilityScore * 0.2 +
    burdenScore * 0.2 +
    liquidityScore * 0.1 +
    conductScore * 0.2;

  // Las tendencias ajustan al final y poco: son direcciones, no niveles, y
  // dejarlas pesar como una dimensión más haría que tres meses de datos movieran
  // el puntaje por su pendiente antes que por su altura.
  const trendAdjustment = (income.trend < -0.03 ? -5 : 0) + (obligations.trend > 0.05 ? -5 : 0);

  return Math.round(clamp(blended + trendAdjustment, 0, 100));
}

/**
 * La banda, con un suelo duro: sin cuota que quepa no hay banda buena.
 *
 * Sin esta condición un expediente con ingreso estable, sin deudas y sin margen
 * —porque todo su ingreso se va en gasto esencial— podía salir `ADECUADA` por
 * puntaje. La banda tiene que ser coherente con la única cifra que después se
 * usa para prestar.
 */
export function bandOf(score: number, capacity: CapacityAssessment): AffordabilityBand {
  if (capacity.maxAffordableInstallment <= 0) return 'INSUFICIENTE';
  if (score >= 75) return 'SOLIDA';
  if (score >= 55) return 'ADECUADA';
  if (score >= 35) return 'AJUSTADA';
  return 'INSUFICIENTE';
}
