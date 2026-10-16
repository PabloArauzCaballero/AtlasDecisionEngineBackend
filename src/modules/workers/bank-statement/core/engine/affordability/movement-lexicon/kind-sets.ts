import { InflowKind, OutflowKind } from './types';

/**
 * Gastos que NO se pueden dejar de pagar el mes que viene.
 *
 * Es la lista que define el denominador honesto del disponible. El retiro de
 * efectivo entra —y es discutible— porque no se sabe en qué se fue: tratarlo
 * como discrecional supondría que la persona puede dejar de sacar dinero, y en
 * una economía donde buena parte del gasto doméstico se paga en efectivo eso
 * sería suponer que puede dejar de comer.
 */
export const COMMITTED_OUTFLOWS: ReadonlySet<OutflowKind> = new Set<OutflowKind>([
  'DEBT_SERVICE',
  'INSURANCE_CONTRIBUTION',
  'ESSENTIAL',
  'TAX_FEE',
  'CASH_WITHDRAWAL',
]);

/** Lo que es compromiso con un TERCERO, que es lo que mide el endeudamiento. */
export const THIRD_PARTY_OBLIGATIONS: ReadonlySet<OutflowKind> = new Set<OutflowKind>([
  'DEBT_SERVICE',
  'INSURANCE_CONTRIBUTION',
]);

/** Abonos que cuentan como ingreso reconocible por su glosa. */
export const RECOGNIZED_INFLOWS: ReadonlySet<InflowKind> = new Set<InflowKind>([
  'PAYROLL',
  'BUSINESS',
  'RECURRING_OTHER',
]);
