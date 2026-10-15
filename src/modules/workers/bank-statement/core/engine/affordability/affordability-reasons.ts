import type {
  AffordabilityAssessment,
  AffordabilityReason,
  AffordabilityReasonCode,
  CapacityAssessment,
  ExpenseAssessment,
  IncomeAssessment,
  ObligationAssessment,
  AffordabilityRiskSignals,
} from './affordability-model';
import type { AffordabilityPolicy } from './affordability-policy';

export function explain(
  coverage: AffordabilityAssessment['coverage'],
  income: IncomeAssessment,
  expenses: ExpenseAssessment,
  obligations: ObligationAssessment,
  capacity: CapacityAssessment,
  signals: AffordabilityRiskSignals,
  policy: AffordabilityPolicy,
): AffordabilityReason[] {
  const reasons: AffordabilityReason[] = [];
  const add = (
    code: AffordabilityReasonCode,
    severity: AffordabilityReason['severity'],
    message: string,
    evidence?: string,
  ) => reasons.push({ code, severity, message, evidence });

  if (income.monthlyRecognized <= 0) {
    add(
      'AFF_SIN_INGRESO_RECONOCIDO',
      'BLOCKING',
      'No se reconoció ningún ingreso periódico en el extracto.',
      `${String(coverage.monthsComplete)} mes(es) analizado(s)`,
    );
  }
  if (income.variability > 0.35) {
    add(
      'AFF_INGRESO_VOLATIL',
      'MEDIUM',
      'El ingreso cambia bastante de un mes a otro, así que se evalúa con un margen mayor.',
      `variación ${String(Math.round(income.variability * 100))}%`,
    );
  }
  if (income.trend < -0.03) {
    add(
      'AFF_INGRESO_DECRECIENTE',
      'HIGH',
      'El ingreso viene bajando mes a mes en el periodo analizado.',
      `${String(Math.round(income.trend * 100))}% por mes`,
    );
  }
  if (income.concentration > 0.9 && income.streams.length <= 1) {
    add(
      'AFF_INGRESO_CONCENTRADO',
      'INFO',
      'Todo el ingreso proviene de una sola fuente.',
      income.streams[0]?.label ?? undefined,
    );
  }
  if (obligations.debtServiceRatio > policy.debtServiceToIncomeCap) {
    add(
      'AFF_CARGA_DE_DEUDA_ALTA',
      'HIGH',
      'Las cuotas y seguros que ya paga se llevan una parte alta de su ingreso.',
      `${String(Math.round(obligations.debtServiceRatio * 100))}% del ingreso`,
    );
  }
  if (obligations.isLowerBound) {
    add(
      'AFF_DEUDA_EXTERNA_NO_OBSERVADA',
      'INFO',
      'La carga de deuda que se publica es un SUELO: sólo se ve lo que pasa por esta cuenta. ' +
        'Una cuota pagada desde otro banco no aparece aquí y no se ha supuesto que valga cero.',
      `observado ${String(obligations.observedMonthly)}; externo no observado`,
    );
  }
  if (obligations.trend > 0.05) {
    add(
      'AFF_DEUDA_CRECIENTE',
      'HIGH',
      'Sus compromisos con terceros crecen mes a mes.',
      `+${String(Math.round(obligations.trend * 100))}% por mes`,
    );
  }
  if (expenses.trend > 0.08) {
    add(
      'AFF_GASTO_CRECIENTE',
      'MEDIUM',
      'El gasto que no puede dejar de pagar viene subiendo.',
      `+${String(Math.round(expenses.trend * 100))}% por mes`,
    );
  }
  if (capacity.maxAffordableInstallment <= 0) {
    add(
      'AFF_SIN_MARGEN',
      'BLOCKING',
      'No queda margen entre lo que entra y lo que ya está comprometido.',
      `disponible tensionado ${String(capacity.stressedDisposableIncome)}`,
    );
  }
  if (signals.nsfEvents > 0) {
    add(
      'AFF_RECHAZOS_POR_FONDOS',
      'HIGH',
      'Hubo cargos rechazados por fondos insuficientes.',
      `${String(signals.nsfEvents)} en ${String(signals.nsfMonths)} mes(es)`,
    );
  }
  if (signals.monthsEndingNegative > 0) {
    add(
      'AFF_SALDO_AL_LIMITE',
      'MEDIUM',
      'La cuenta cerró algún mes en negativo.',
      `${String(signals.monthsEndingNegative)} mes(es)`,
    );
  }
  if (signals.highRiskMonths > 0) {
    add(
      'AFF_GASTO_DE_ALTO_RIESGO',
      'MEDIUM',
      'Hay gasto en apuestas, casinos o especulación.',
      `${String(signals.highRiskSpend)} en ${String(signals.highRiskMonths)} mes(es)`,
    );
  }
  if (signals.creditDisbursementsReceived > 0 && obligations.monthly > 0) {
    add(
      'AFF_ENDEUDAMIENTO_CIRCULAR',
      'HIGH',
      'Entran desembolsos de crédito mientras se pagan cuotas: la deuda se está financiando con más deuda.',
      `${String(signals.creditDisbursementsReceived)} recibidos`,
    );
  }
  if (signals.collectionActions > 0) {
    add(
      'AFF_GESTION_DE_COBRANZA',
      'HIGH',
      'Aparecen gestiones de cobranza sobre la cuenta.',
      `${String(signals.collectionActions)} movimiento(s)`,
    );
  }

  if (reasons.length === 0) {
    add(
      'AFF_CAPACIDAD_SOSTENIDA',
      'INFO',
      'El extracto muestra un ingreso estable con margen suficiente sobre lo ya comprometido.',
      `cuota máxima ${String(capacity.maxAffordableInstallment)}`,
    );
  }
  return reasons;
}

export function insufficientPeriodReason(complete: number, required: number): AffordabilityReason {
  return {
    code: 'AFF_PERIODO_INSUFICIENTE',
    severity: 'BLOCKING',
    message:
      `El extracto cubre ${String(complete)} mes(es) completo(s) y se necesitan ${String(required)}. ` +
      'Con menos meses, un ingreso extraordinario o un gasto puntual bastan para falsear el cálculo.',
    evidence: `${String(complete)}/${String(required)} meses`,
  };
}
