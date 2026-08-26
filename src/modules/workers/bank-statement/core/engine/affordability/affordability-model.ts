/**
 * El contrato de la capacidad de pago: lo que el motor afirma de un extracto y
 * con qué evidencia lo sostiene.
 *
 * Todo lo que hay aquí es OBSERVADO o DERIVADO de lo observado. No hay ni un
 * campo que dependa de algo que el solicitante declare, y ésa es la razón de ser
 * del módulo: un formulario donde alguien escribe su ingreso mide lo que esa
 * persona cree —o quiere— que gana; un extracto de tres meses mide lo que entró
 * en su cuenta.
 *
 * ## Por qué cada cifra viaja con su intervalo y su tendencia
 *
 * Porque un número solo no es una afirmación comprobable. «Ingreso 4.200» puede
 * ser cuatro meses de 4.200 o tres de 1.000 y uno de 13.800, y las dos personas
 * no merecen el mismo crédito. Publicar la mediana, la media recortada, la
 * dispersión y la pendiente convierte una cifra en una descripción, y es lo que
 * permite que quien revisa discrepe con argumentos en vez de con intuición.
 */

import type { InflowKind, OutflowKind } from './movement-lexicon';

/** Motivos con los que la evaluación se explica. Son estables: se miden. */
export type AffordabilityReasonCode =
  /** El extracto no cubre los meses mínimos exigidos. Bloquea la evaluación. */
  | 'AFF_PERIODO_INSUFICIENTE'
  /** Hay meses pero casi no hay movimientos: la cuenta no es la que usa. */
  | 'AFF_ACTIVIDAD_MINIMA'
  /** No se reconoció ningún ingreso periódico. */
  | 'AFF_SIN_INGRESO_RECONOCIDO'
  /** El ingreso reconocido varía demasiado de un mes a otro. */
  | 'AFF_INGRESO_VOLATIL'
  /** El ingreso viene cayendo mes a mes. */
  | 'AFF_INGRESO_DECRECIENTE'
  /** Depende de una sola fuente de ingreso. */
  | 'AFF_INGRESO_CONCENTRADO'
  /** Las obligaciones con terceros se comen una parte alta del ingreso. */
  | 'AFF_CARGA_DE_DEUDA_ALTA'
  /** Las obligaciones crecen mes a mes. */
  | 'AFF_DEUDA_CRECIENTE'
  /** El gasto comprometido crece mes a mes. */
  | 'AFF_GASTO_CRECIENTE'
  /** No queda margen entre lo que entra y lo que ya está comprometido. */
  | 'AFF_SIN_MARGEN'
  /** Hubo rechazos por fondos insuficientes. */
  | 'AFF_RECHAZOS_POR_FONDOS'
  /** La cuenta pasó días en saldo negativo o al borde. */
  | 'AFF_SALDO_AL_LIMITE'
  /** Gasto en apuestas, casinos o especulación. */
  | 'AFF_GASTO_DE_ALTO_RIESGO'
  /** Entran desembolsos de crédito mientras se pagan cuotas: se financia la deuda con deuda. */
  | 'AFF_ENDEUDAMIENTO_CIRCULAR'
  /** Aparecen gestiones de cobranza sobre la cuenta. */
  | 'AFF_GESTION_DE_COBRANZA'
  /** Nada que objetar. */
  | 'AFF_CAPACIDAD_SOSTENIDA';

export interface AffordabilityReason {
  readonly code: AffordabilityReasonCode;
  readonly severity: 'BLOCKING' | 'HIGH' | 'MEDIUM' | 'INFO';
  readonly message: string;
  /** La cifra que lo sostiene, para que el motivo se pueda comprobar. */
  readonly evidence?: string;
}

/** Un mes natural del extracto, con todo lo que ocurrió dentro. */
export interface MonthlyBucket {
  /** `AAAA-MM`. */
  readonly month: string;
  readonly transactionCount: number;
  readonly inflowTotal: number;
  readonly outflowTotal: number;
  /** Abonos que cuentan como ingreso: los reconocidos por glosa o por cadencia. */
  readonly recognizedIncome: number;
  /** Cuotas y seguros: lo comprometido con terceros. */
  readonly thirdPartyObligations: number;
  /** Todo lo que no se puede dejar de pagar el mes que viene. */
  readonly committedSpend: number;
  readonly discretionarySpend: number;
  readonly nsfEvents: number;
  readonly closingBalance: number | null;
  readonly minBalance: number | null;
  /** Días del mes que el extracto cubre de verdad. */
  readonly daysCovered: number;
  /** Si el mes natural está cubierto entero. Sólo éstos cuentan para la política. */
  readonly complete: boolean;
}

/** Un flujo que se repite: un sueldo, una cuota, un seguro. */
export interface RecurringStream {
  /** La glosa normalizada que lo identifica, recortada. */
  readonly label: string;
  readonly direction: 'INFLOW' | 'OUTFLOW';
  readonly kind: InflowKind | OutflowKind;
  /** En cuántos meses distintos aparece. */
  readonly monthsSeen: number;
  readonly medianAmount: number;
  readonly monthlyAmount: number;
  /** Dispersión relativa del importe entre apariciones. */
  readonly variability: number;
  readonly lastSeenMonth: string | null;
  readonly occurrences: number;
}

/** Señales de conducta. No son gasto: son cómo se administra la cuenta. */
export interface AffordabilityRiskSignals {
  readonly nsfEvents: number;
  readonly nsfMonths: number;
  readonly monthsEndingNegative: number;
  readonly minBalanceObserved: number | null;
  /** Colchón: días de gasto comprometido que cubre el saldo más bajo del periodo. */
  readonly cashCushionDays: number | null;
  readonly highRiskSpend: number;
  readonly highRiskMonths: number;
  readonly creditDisbursementsReceived: number;
  readonly collectionActions: number;
  /** Traspasos entre cuentas propias sobre el total de abonos. Infla el ingreso aparente. */
  readonly internalTransferRatio: number;
  readonly reversalRatio: number;
}

/** Lo que se afirma del ingreso, con la evidencia que lo sostiene. */
export interface IncomeAssessment {
  /** La cifra con la que se decide: la menor entre mediana y media recortada. */
  readonly monthlyRecognized: number;
  readonly median: number;
  readonly trimmedMean: number;
  /** Tras aplicar el castigo por volatilidad y por tendencia a la baja. */
  readonly stressed: number;
  /** 0..1. Coeficiente de variación entre meses. */
  readonly variability: number;
  /** 0..100. */
  readonly stabilityScore: number;
  /** Variación relativa por mes. Negativa es caída. */
  readonly trend: number;
  /** Proporción del ingreso que aporta la fuente principal. */
  readonly concentration: number;
  readonly streams: readonly RecurringStream[];
  /** Abonos descartados y por qué, para que la resta se pueda auditar. */
  readonly excluded: Readonly<Record<string, number>>;
}

/** Lo que se afirma del gasto. */
export interface ExpenseAssessment {
  /** Mediana mensual de lo que no se puede dejar de pagar. */
  readonly committedMonthly: number;
  /** El que se usa: el mayor entre lo observado y el piso de subsistencia. */
  readonly effectiveMonthly: number;
  readonly discretionaryMonthly: number;
  readonly trend: number;
  /** Si mandó el piso de subsistencia en vez de lo observado. */
  readonly subsistenceFloorApplied: boolean;
}

/** Lo que se afirma de las obligaciones con terceros. */
export interface ObligationAssessment {
  readonly monthly: number;
  readonly trend: number;
  /** Cuota comprometida sobre ingreso reconocido. */
  readonly debtServiceRatio: number;
  readonly streams: readonly RecurringStream[];
}

/** La capacidad propiamente dicha: cuánto cabe. */
export interface CapacityAssessment {
  readonly disposableIncome: number;
  /** El disponible después del escenario de tensión. Es el que manda. */
  readonly stressedDisposableIncome: number;
  /** Lo máximo que puede comprometerse en una cuota nueva. */
  readonly maxAffordableInstallment: number;
  /** Qué límite mordió primero: la política, el disponible o el colchón. */
  readonly bindingConstraint: 'DSTI' | 'PTI' | 'DISPONIBLE' | 'SIN_MARGEN';
  /** Cuota nueva sobre ingreso, si se usara todo el máximo. */
  readonly paymentToIncome: number;
  /** Deuda total (existente + nueva) sobre ingreso. */
  readonly debtToIncome: number;
}

/** Cobertura del extracto frente a la política de meses mínimos. */
export interface PeriodCoverage {
  readonly minimumMonthsRequired: number;
  readonly monthsObserved: number;
  readonly monthsComplete: number;
  readonly from: string | null;
  readonly to: string | null;
  readonly daysSpanned: number;
  readonly satisfied: boolean;
  /** Meses del rango sin un solo movimiento. Un hueco no es un mes cubierto. */
  readonly gapMonths: readonly string[];
}

export type AffordabilityBand = 'SOLIDA' | 'ADECUADA' | 'AJUSTADA' | 'INSUFICIENTE';

export interface AffordabilityAssessment {
  readonly coverage: PeriodCoverage;
  /** Si el extracto sirve para decidir. Con `false`, nada de lo demás decide nada. */
  readonly eligible: boolean;
  readonly currency: string | null;
  readonly months: readonly MonthlyBucket[];
  readonly income: IncomeAssessment;
  readonly expenses: ExpenseAssessment;
  readonly obligations: ObligationAssessment;
  readonly capacity: CapacityAssessment;
  readonly signals: AffordabilityRiskSignals;
  /** 0..100. */
  readonly score: number;
  readonly band: AffordabilityBand;
  readonly reasons: readonly AffordabilityReason[];
  /** Versión del algoritmo. Va en la traza: una cifra sin versión no se puede auditar. */
  readonly modelVersion: string;
}
