import { AffordabilityPolicy } from './types';

/**
 * Cada parámetro de la política, atado a su auditoría en el corpus.
 *
 * ## Para qué sirve una tabla de procedencia
 *
 * Para que la evaluación pueda decir la verdad sobre sí misma. Un informe que
 * publica «capacidad de pago: 1.240 Bs» sin decir que el 35 % con el que se
 * calculó no está calibrado contra ninguna cartera invita a tratar la cifra como
 * una medición. Con esto, `AffordabilityAssessment.calibration` puede llevar el
 * estado real, y quien lea el número sabe qué clase de número es.
 *
 * Es también la defensa contra la deriva silenciosa: si alguien mueve un valor
 * por defecto, la prueba `corpus-extractos-regresion.spec.ts` compara contra el
 * `valorActual` que audita el corpus y avisa de que ya no son el mismo número.
 */
export interface PolicyParameterProvenance {
  /** Campo de `AffordabilityPolicy`. */
  readonly field: keyof AffordabilityPolicy;
  /** Identificador de la auditoría en el corpus (`installment_to_income_cap`…). */
  readonly auditId: string;
  /** El valor que el corpus audita, para poder detectar que el código se desvió. */
  readonly auditedValue: number;
  readonly calibratedAgainstArrears: false;
  readonly verifiedReplacement: null;
}

export const AFFORDABILITY_PARAMETER_PROVENANCE: readonly PolicyParameterProvenance[] = [
  {
    field: 'minimumMonths',
    auditId: 'complete_calendar_months',
    auditedValue: 3,
    calibratedAgainstArrears: false,
    verifiedReplacement: null,
  },
  {
    field: 'minimumTransactionsPerMonth',
    auditId: 'minimum_monthly_transactions',
    auditedValue: 3,
    calibratedAgainstArrears: false,
    verifiedReplacement: null,
  },
  {
    field: 'paymentToIncomeCap',
    auditId: 'installment_to_income_cap',
    auditedValue: 0.15,
    calibratedAgainstArrears: false,
    verifiedReplacement: null,
  },
  {
    field: 'debtServiceToIncomeCap',
    auditId: 'total_debt_service_to_income_cap',
    auditedValue: 0.35,
    calibratedAgainstArrears: false,
    verifiedReplacement: null,
  },
  {
    field: 'prudenceShare',
    auditId: 'disposable_income_commitment',
    auditedValue: 0.5,
    calibratedAgainstArrears: false,
    verifiedReplacement: null,
  },
  {
    field: 'maximumIncomeHaircut',
    auditId: 'maximum_income_volatility_haircut',
    auditedValue: 0.35,
    calibratedAgainstArrears: false,
    verifiedReplacement: null,
  },
  {
    field: 'subsistenceFloor',
    auditId: 'subsistence_floor',
    auditedValue: 2750,
    calibratedAgainstArrears: false,
    verifiedReplacement: null,
  },
  {
    field: 'cashCushionTargetDays',
    auditId: 'minimum_balance_expense_days',
    auditedValue: 15,
    calibratedAgainstArrears: false,
    verifiedReplacement: null,
  },
];

/**
 * Lo que la evaluación publica sobre la naturaleza de sus propios umbrales.
 *
 * `MEASUREMENT_NOT_APPROVAL` es literal del corpus, y describe el papel del
 * motor entero: mide, no aprueba.
 */
export const AFFORDABILITY_CALIBRATION_STATUS = {
  status: 'NOT_CALIBRATED_AGAINST_OBSERVED_ARREARS',
  engineRole: 'MEASUREMENT_NOT_APPROVAL',
  parametersAudited: AFFORDABILITY_PARAMETER_PROVENANCE.length,
  parametersCalibrated: 0,
  /** Lo que haría falta para cambiar esto, en una frase. */
  requires:
    'Cartera con mora observada en cohortes maduras, split por cliente y tiempo, ' +
    'e intervalos por subgrupo. Una rejilla de sensibilidad no es una calibración.',
} as const;
