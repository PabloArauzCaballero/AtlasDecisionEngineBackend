import { AffordabilityPolicy } from './types';

export const DEFAULT_AFFORDABILITY_POLICY: AffordabilityPolicy = {
  minimumMonths: 3,
  minimumTransactionsPerMonth: 3,
  paymentToIncomeCap: 0.15,
  debtServiceToIncomeCap: 0.35,
  prudenceShare: 0.5,
  maximumIncomeHaircut: 0.35,
  subsistenceFloor: 2750,
  cashCushionTargetDays: 15,
  enforceMinimumMonths: false,
};

/**
 * Sanea una política parcial contra la de por defecto.
 *
 * `minimumMonths` no baja de 3 por configuración, y es la única constante de
 * este archivo que se defiende de quien la configura. Todo lo demás son
 * calibraciones; ésta es la exigencia que da sentido al módulo, y poder bajarla
 * desde una variable de entorno la convertiría en una que alguien apaga el día
 * que la conversión rechaza demasiado.
 */
export function normalizeAffordabilityPolicy(
  overrides: Partial<AffordabilityPolicy> = {},
): AffordabilityPolicy {
  const merged = { ...DEFAULT_AFFORDABILITY_POLICY, ...overrides };
  return {
    ...merged,
    minimumMonths: Math.max(DEFAULT_AFFORDABILITY_POLICY.minimumMonths, merged.minimumMonths),
    minimumTransactionsPerMonth: Math.max(0, merged.minimumTransactionsPerMonth),
    paymentToIncomeCap: bounded(merged.paymentToIncomeCap, 0.01, 1),
    debtServiceToIncomeCap: bounded(merged.debtServiceToIncomeCap, 0.05, 1),
    prudenceShare: bounded(merged.prudenceShare, 0.1, 1),
    maximumIncomeHaircut: bounded(merged.maximumIncomeHaircut, 0, 0.9),
    subsistenceFloor: Math.max(0, merged.subsistenceFloor),
    cashCushionTargetDays: Math.max(0, merged.cashCushionTargetDays),
  };
}

function bounded(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}
