import type { ExpenseAssessment, MonthlyBucket } from './affordability-model';
import type { AffordabilityPolicy } from './affordability-policy';
import { median, relativeTrend, round2, round4, winsorize } from './statistics';

export function assessExpenses(
  scored: readonly MonthlyBucket[],
  policy: AffordabilityPolicy,
): ExpenseAssessment {
  /*
   * El gasto comprometido se WINSORIZA antes de sacar su mediana. El mes con la
   * matrícula del colegio o el seguro anual sigue contando —es un gasto real que
   * volverá— pero recortado al percentil 90 no fija él solo la línea base de los
   * doce meses siguientes. Eliminarlo fingiría que no ocurrió; dejarlo entero
   * convertiría un pago anual en un compromiso mensual.
   */
  const committedSeries = winsorize(scored.map((month) => month.committedSpend));
  const committed = median(committedSeries) ?? 0;
  const discretionary = median(scored.map((month) => month.discretionarySpend)) ?? 0;
  const effective = Math.max(committed, policy.subsistenceFloor);

  return {
    committedMonthly: round2(committed),
    effectiveMonthly: round2(effective),
    discretionaryMonthly: round2(discretionary),
    trend: round4(relativeTrend(scored.map((month) => month.committedSpend))),
    subsistenceFloorApplied: effective > committed,
  };
}
