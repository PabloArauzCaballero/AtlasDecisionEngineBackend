import type {
  CapacityAssessment,
  ExpenseAssessment,
  IncomeAssessment,
  ObligationAssessment,
} from './affordability-model';
import type { AffordabilityPolicy } from './affordability-policy';
import { clamp, round2, round4 } from './statistics';

export function computeCapacity(
  income: IncomeAssessment,
  expenses: ExpenseAssessment,
  obligations: ObligationAssessment,
  policy: AffordabilityPolicy,
): CapacityAssessment {
  const disposable = Math.max(0, income.monthlyRecognized - expenses.effectiveMonthly);

  /*
   * El disponible tensionado añade al ingreso ya castigado una previsión de que
   * el gasto siga la tendencia que trae. Sólo cuando SUBE: un gasto que baja
   * puede estar bajando porque la persona se está apretando, y contarlo como
   * margen futuro sería prestarle contra un sacrificio que quizá no sostenga.
   */
  const expenseUplift = 1 + clamp(expenses.trend, 0, 0.25);
  const stressed = Math.max(0, income.stressed - expenses.effectiveMonthly * expenseUplift);

  const byDisposable = stressed * policy.prudenceShare;
  const byPaymentToIncome = income.monthlyRecognized * policy.paymentToIncomeCap;
  const byDebtService = Math.max(
    0,
    income.monthlyRecognized * policy.debtServiceToIncomeCap - obligations.monthly,
  );

  const candidates: ReadonlyArray<{
    limit: number;
    constraint: CapacityAssessment['bindingConstraint'];
  }> = [
    { limit: byDisposable, constraint: 'DISPONIBLE' },
    { limit: byPaymentToIncome, constraint: 'PTI' },
    { limit: byDebtService, constraint: 'DSTI' },
  ];
  const binding = candidates.reduce((lowest, candidate) =>
    candidate.limit < lowest.limit ? candidate : lowest,
  );
  const installment = Math.max(0, binding.limit);

  return {
    disposableIncome: round2(disposable),
    stressedDisposableIncome: round2(stressed),
    maxAffordableInstallment: round2(installment),
    bindingConstraint: installment <= 0 ? 'SIN_MARGEN' : binding.constraint,
    paymentToIncome:
      income.monthlyRecognized > 0 ? round4(installment / income.monthlyRecognized) : 0,
    debtToIncome:
      income.monthlyRecognized > 0
        ? round4((obligations.monthly + installment) / income.monthlyRecognized)
        : 0,
  };
}
