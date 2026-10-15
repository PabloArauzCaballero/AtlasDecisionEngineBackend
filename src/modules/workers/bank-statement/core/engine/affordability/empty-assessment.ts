import type { AffordabilityAssessment } from './affordability-model';
import { AFFORDABILITY_CALIBRATION_STATUS, type AffordabilityPolicy } from './affordability-policy';
import { insufficientPeriodReason } from './affordability-reasons';
import { CONCENTRATION_WINDOW_DAYS } from './economic-plausibility';
import { AFFORDABILITY_MODEL_VERSION } from './model-version';

export function emptyAssessment(
  policy: AffordabilityPolicy,
  currency: string | null,
): AffordabilityAssessment {
  return {
    coverage: {
      minimumMonthsRequired: policy.minimumMonths,
      monthsObserved: 0,
      monthsComplete: 0,
      from: null,
      to: null,
      daysSpanned: 0,
      satisfied: false,
      gapMonths: [],
    },
    eligible: false,
    currency,
    months: [],
    income: {
      monthlyRecognized: 0,
      median: 0,
      trimmedMean: 0,
      stressed: 0,
      variability: 0,
      stabilityScore: 0,
      trend: 0,
      concentration: 0,
      streams: [],
      excluded: {},
    },
    expenses: {
      committedMonthly: 0,
      effectiveMonthly: policy.subsistenceFloor,
      discretionaryMonthly: 0,
      trend: 0,
      subsistenceFloorApplied: true,
    },
    obligations: {
      monthly: 0,
      observedMonthly: 0,
      externalDebtService: null,
      isLowerBound: true,
      trend: 0,
      debtServiceRatio: 0,
      streams: [],
    },
    capacity: {
      disposableIncome: 0,
      stressedDisposableIncome: 0,
      maxAffordableInstallment: 0,
      bindingConstraint: 'SIN_MARGEN',
      paymentToIncome: 0,
      debtToIncome: 0,
    },
    signals: {
      nsfEvents: 0,
      nsfMonths: 0,
      monthsEndingNegative: 0,
      minBalanceObserved: null,
      timeWeightedMeanBalance: null,
      balanceDaysCovered: 0,
      negativeBalanceDays: 0,
      overdraftEpisodes: 0,
      cashCushionDays: null,
      highRiskSpend: 0,
      highRiskMonths: 0,
      creditDisbursementsReceived: 0,
      collectionActions: 0,
      internalTransferRatio: 0,
      reversalRatio: 0,
      plausibility: {
        pairedCounterpartyRatio: 0,
        bidirectionalCounterparties: 0,
        concentrationWindowDays: CONCENTRATION_WINDOW_DAYS,
        preCloseInflowRatio: 0,
        duplicateMovements: 0,
        outflowToInflowRatio: null,
      },
    },
    score: 0,
    band: 'INSUFICIENTE',
    reasons: [insufficientPeriodReason(0, policy.minimumMonths)],
    modelVersion: AFFORDABILITY_MODEL_VERSION,
    calibration: { ...AFFORDABILITY_CALIBRATION_STATUS },
  };
}
