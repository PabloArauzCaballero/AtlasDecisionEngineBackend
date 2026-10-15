import type { AffordabilityRiskSignals, MonthlyBucket } from './affordability-model';
import type { BalanceSeries } from './balance-series';
import type { EconomicPlausibility } from './economic-plausibility';
import { isCollectionAction } from './movement-lexicon';
import type { ClassifiedMovement } from './monthly-series';
import { round2, round4 } from './statistics';

export function assessSignals(
  scored: readonly MonthlyBucket[],
  movements: readonly ClassifiedMovement[],
  committedMonthly: number,
  balances: BalanceSeries,
  plausibility: EconomicPlausibility,
): AffordabilityRiskSignals {
  const nsfEvents = scored.reduce((sum, month) => sum + month.nsfEvents, 0);
  const minBalance = balances.minimum;

  const highRiskByMonth = new Map<string, number>();
  let highRiskSpend = 0;
  let creditDisbursements = 0;
  let internalInflow = 0;
  let reversalInflow = 0;
  let inflowTotal = 0;
  let collectionActions = 0;

  for (const movement of movements) {
    if (isCollectionAction(movement.description)) collectionActions += 1;
    if (movement.direction === 'OUTFLOW' && movement.kind === 'HIGH_RISK') {
      highRiskSpend += movement.amount;
      highRiskByMonth.set(movement.month, (highRiskByMonth.get(movement.month) ?? 0) + 1);
    }
    if (movement.direction === 'INFLOW') {
      inflowTotal += movement.amount;
      if (movement.kind === 'CREDIT_DISBURSEMENT') creditDisbursements += movement.amount;
      if (movement.kind === 'INTERNAL_TRANSFER') internalInflow += movement.amount;
      if (movement.kind === 'REVERSAL') reversalInflow += movement.amount;
    }
  }

  const dailyCommitted = committedMonthly / 30;

  return {
    nsfEvents,
    nsfMonths: scored.filter((month) => month.nsfEvents > 0).length,
    monthsEndingNegative: scored.filter(
      (month) => month.closingBalance !== null && month.closingBalance < 0,
    ).length,
    minBalanceObserved: minBalance === null ? null : round2(minBalance),
    /*
     * La media ponderada por tiempo acompaña SIEMPRE al mínimo, nunca lo
     * sustituye. Ver la cabecera de `balance-series.ts`: con una sola de las dos
     * medidas, la cuenta que tuvo diez mil casi todo el mes y la que no tuvo
     * nada nunca se leen igual.
     */
    timeWeightedMeanBalance:
      balances.timeWeightedMean === null ? null : round2(balances.timeWeightedMean),
    balanceDaysCovered: balances.daysCovered,
    negativeBalanceDays: balances.negativeDays,
    overdraftEpisodes: balances.overdraftEpisodes,
    cashCushionDays:
      minBalance === null || dailyCommitted <= 0
        ? null
        : Math.max(0, Math.round(minBalance / dailyCommitted)),
    highRiskSpend: round2(highRiskSpend),
    highRiskMonths: highRiskByMonth.size,
    creditDisbursementsReceived: round2(creditDisbursements),
    collectionActions,
    internalTransferRatio: inflowTotal > 0 ? round4(internalInflow / inflowTotal) : 0,
    reversalRatio: inflowTotal > 0 ? round4(reversalInflow / inflowTotal) : 0,
    plausibility,
  };
}
