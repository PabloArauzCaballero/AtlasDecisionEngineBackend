/** Qué representa un ABONO. */
export type InflowKind =
  /** Sueldo, planilla, remesa periódica de un empleador. Es el ingreso de verdad. */
  | 'PAYROLL'
  /** Cobro de actividad propia: ventas, honorarios, QR de comercio. */
  | 'BUSINESS'
  /** Renta, alquiler, pensión, beneficio social, remesa del exterior. */
  | 'RECURRING_OTHER'
  /** Desembolso de un préstamo o adelanto: entra dinero y nace una deuda. */
  | 'CREDIT_DISBURSEMENT'
  /** Reverso, anulación o devolución de un cargo propio. No es ingreso. */
  | 'REVERSAL'
  /** Traspaso entre cuentas del propio titular. No es ingreso. */
  | 'INTERNAL_TRANSFER'
  /** Intereses, premios, y todo lo que entra una vez y no vuelve. */
  | 'ONE_OFF';

/** Qué representa un CARGO. */
export type OutflowKind =
  /** Cuota de préstamo, tarjeta, leasing, compra a plazos. Compromiso con un tercero. */
  | 'DEBT_SERVICE'
  /** Seguro, aporte a pensiones, cuota de afiliación. Comprometido y no negociable a corto plazo. */
  | 'INSURANCE_CONTRIBUTION'
  /** Servicios básicos, alquiler, colegio, salud. Gasto esencial no comprimible. */
  | 'ESSENTIAL'
  /** Impuestos, ITF, comisiones y mantenimiento de cuenta. */
  | 'TAX_FEE'
  /** Retiro de efectivo. Ni esencial ni discrecional: no se sabe en qué se fue. */
  | 'CASH_WITHDRAWAL'
  /** Traspaso a otra cuenta del titular. */
  | 'INTERNAL_TRANSFER'
  /** Apuestas, casinos, criptoactivos especulativos. Señal de conducta, no gasto. */
  | 'HIGH_RISK'
  /** Todo lo demás: consumo comprimible. */
  | 'DISCRETIONARY';

export interface Rule {
  readonly kind: InflowKind | OutflowKind;
  readonly patterns: readonly RegExp[];
}
