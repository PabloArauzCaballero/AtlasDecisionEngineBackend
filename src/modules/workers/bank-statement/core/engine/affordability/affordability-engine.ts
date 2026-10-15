/**
 * La capacidad de pago derivada del extracto, y sólo del extracto.
 *
 * ## El error que este módulo existe para no cometer
 *
 * La versión anterior de este cálculo sumaba los abonos, sumaba los cargos y
 * restaba. Producía un número con dos problemas graves y opuestos:
 *
 * 1. **Inflaba el ingreso.** Todo lo que entraba contaba: el traspaso desde la
 *    caja de ahorro del propio titular, el reverso de una compra anulada, el
 *    desembolso de un préstamo. Un extracto con tres traspasos internos de
 *    5.000 declaraba 15.000 de ingreso que nunca existieron.
 * 2. **Sobreestimaba el disponible.** Restar TODO el gasto supone que la persona
 *    no puede dejar de gastar nada; no restar nada supone que puede dejar de
 *    gastarlo todo. Las dos son falsas, y la segunda —que es la que produce un
 *    disponible enorme en los extractos austeros— aprueba a quien no puede pagar.
 *
 * Lo que hay aquí separa cada boliviano en su sitio antes de sumarlo, usa
 * estadísticos robustos sobre al menos tres meses, y **tensiona** el resultado
 * antes de convertirlo en una cuota.
 *
 * ## El orden de las cuatro preguntas
 *
 * 1. ¿Cubre el extracto los meses que hacen falta? Si no, no hay nada más que
 *    preguntar: lo demás sería inventar una tendencia sobre una foto.
 * 2. ¿Cuánto entra de verdad, y con qué regularidad?
 * 3. ¿Cuánto de eso ya está comprometido —con terceros y con la vida— y hacia
 *    dónde va?
 * 4. ¿Cuánto cabe encima sin que el mes malo lo rompa?
 *
 * ## Qué NO hace
 *
 * No decide. Devuelve una evaluación con su puntaje, su banda y sus motivos; la
 * política de crédito —versionada, aprobada y auditable— es la que dice qué
 * hacer con ella. Es la misma frontera que respeta el resto del motor: quien
 * mide no aprueba.
 */

import type { AffordabilityAssessment } from './affordability-model';
import {
  AFFORDABILITY_CALIBRATION_STATUS,
  DEFAULT_AFFORDABILITY_POLICY,
  normalizeAffordabilityPolicy,
  type AffordabilityPolicy,
} from './affordability-policy';
import { explain, insufficientPeriodReason } from './affordability-reasons';
import { bandOf, computeScore } from './affordability-scoring';
import { buildBalanceSeries } from './balance-series';
import { assessEconomicPlausibility } from './economic-plausibility';
import { emptyAssessment } from './empty-assessment';
import { assessExpenses } from './expense-assessment';
import { assessIncome } from './income-assessment';
import { AFFORDABILITY_MODEL_VERSION } from './model-version';
import {
  assessCoverage,
  buildMonthlySeries,
  classifyMovements,
  observationWindow,
  type AffordabilityTransaction,
} from './monthly-series';
import { assessObligations } from './obligation-assessment';
import { findRecurringStreams, recognizableByCadence } from './recurrence';
import { computeCapacity } from './repayment-capacity';
import { assessSignals } from './risk-signals';

export { AFFORDABILITY_MODEL_VERSION };

export interface AffordabilityInput {
  readonly transactions: readonly AffordabilityTransaction[];
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
  readonly currency: string | null;
  readonly closingBalance: number | null;
  /**
   * Sigla ASFI del emisor, cuando el detector la resolvió.
   *
   * Con ella, las glosas se consultan contra el glosario que PUBLICA ese emisor
   * antes de pasar por nuestro léxico de palabras. Es opcional porque la
   * mayoría de los emisores no publica glosario y porque la evaluación tiene que
   * seguir funcionando cuando no se sabe de quién es el documento.
   */
  readonly issuerCode?: string | null;
  /**
   * Servicio mensual de deuda que NO está en este extracto.
   *
   * Llega de fuera —un buró consultado con consentimiento— o no llega. `null`
   * es lo normal y significa NO OBSERVADO, nunca cero: ver `assessObligations`.
   * Es servicio MENSUAL, no saldo de capital; confundirlos multiplica la deuda
   * por el plazo entero y es el error que el corpus nombra explícitamente.
   */
  readonly externalDebtService?: number | null;
}

export function assessAffordability(
  input: AffordabilityInput,
  overrides: Partial<AffordabilityPolicy> = {},
): AffordabilityAssessment {
  const policy = normalizeAffordabilityPolicy(overrides);
  const movements = classifyMovements(input.transactions, { issuerCode: input.issuerCode ?? null });
  const window = observationWindow(movements, { from: input.periodFrom, to: input.periodTo });

  if (!window) return emptyAssessment(policy, input.currency);

  /*
   * DOS pasadas sobre los meses, y la primera existe sólo para poder hacer la
   * segunda. La recurrencia necesita saber cuántos meses tiene el extracto para
   * convertir importes a mensuales, y el agrupado mensual necesita saber qué
   * abonos rescató la recurrencia. Romper el círculo con una pasada previa
   * —barata: agrupa y suma— es más honesto que estimar los meses por la ventana,
   * que contaría como mes uno que no tiene ni un movimiento.
   */
  const provisionalMonths = buildMonthlySeries(movements, window);
  const monthsForCadence = Math.max(1, provisionalMonths.length);
  const recognizedLabels = recognizableByCadence(movements, monthsForCadence);
  const months = buildMonthlySeries(movements, window, recognizedLabels);

  const coverage = assessCoverage(
    movements,
    months,
    { from: input.periodFrom, to: input.periodTo },
    policy.minimumMonths,
  );

  /*
   * Sólo los meses COMPLETOS entran en la estadística.
   *
   * Un mes a medias tiene la mitad de los movimientos, así que baja la mediana
   * del ingreso Y la del gasto a la vez. El disponible que sale de mezclarlo con
   * meses enteros no describe ningún mes que la persona haya vivido, y su error
   * no tiene signo predecible — que es lo peor que le puede pasar a una cifra que
   * después se convierte en una cuota.
   */
  const scored = months.filter((month) => month.complete && month.transactionCount > 0);

  /*
   * El INGRESO se mide sobre los meses cubiertos, con actividad o sin ella.
   *
   * Es la asimetría deliberada de este módulo y conviene entenderla entera. Un
   * mes cubierto en el que no entró nada es una observación de ingreso: vale
   * cero y baja la mediana, que es exactamente lo que describe la vida de quien
   * cobra a temporadas. Un mes cubierto en el que no salió nada, en cambio, NO
   * es una observación de gasto —la persona comió igual, lo pagó desde otro
   * sitio— y meterlo en la mediana de gasto comprometido regalaría disponible.
   *
   * Las dos elecciones empujan hacia el mismo lado: menos ingreso reconocido y
   * no menos gasto. Cuando la observación falta, el error se paga en la
   * dirección que no aprueba de más.
   */
  const incomeMonths = months.filter((month) => month.complete);

  if (!coverage.satisfied) {
    return {
      ...emptyAssessment(policy, input.currency),
      coverage,
      months,
      eligible: false,
      reasons: [insufficientPeriodReason(coverage.monthsComplete, policy.minimumMonths)],
    };
  }

  const inflowStreams = findRecurringStreams(movements, 'INFLOW', scored.length);
  const outflowStreams = findRecurringStreams(movements, 'OUTFLOW', scored.length);

  const income = assessIncome(incomeMonths, movements, inflowStreams, policy);
  const expenses = assessExpenses(scored, policy);
  const obligations = assessObligations(
    scored,
    outflowStreams,
    income.monthlyRecognized,
    input.externalDebtService ?? null,
  );
  const balances = buildBalanceSeries(movements, window);
  const plausibility = assessEconomicPlausibility(movements, window);
  const signals = assessSignals(
    scored,
    movements,
    expenses.effectiveMonthly,
    balances,
    plausibility,
  );
  const capacity = computeCapacity(income, expenses, obligations, policy);

  const reasons = explain(coverage, income, expenses, obligations, capacity, signals, policy);
  const score = computeScore(income, obligations, capacity, signals, policy);

  return {
    coverage,
    eligible: true,
    currency: input.currency,
    months,
    income,
    expenses,
    obligations,
    capacity,
    signals,
    score,
    band: bandOf(score, capacity),
    reasons,
    modelVersion: AFFORDABILITY_MODEL_VERSION,
    calibration: { ...AFFORDABILITY_CALIBRATION_STATUS },
  };
}

export { DEFAULT_AFFORDABILITY_POLICY };
export type { AffordabilityPolicy, AffordabilityTransaction };
