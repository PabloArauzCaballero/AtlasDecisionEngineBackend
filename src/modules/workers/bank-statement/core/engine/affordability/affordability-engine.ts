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

import type {
  AffordabilityAssessment,
  AffordabilityBand,
  AffordabilityReason,
  AffordabilityReasonCode,
  CapacityAssessment,
  ExpenseAssessment,
  IncomeAssessment,
  MonthlyBucket,
  ObligationAssessment,
  AffordabilityRiskSignals,
  RecurringStream,
} from './affordability-model';
import {
  AFFORDABILITY_CALIBRATION_STATUS,
  DEFAULT_AFFORDABILITY_POLICY,
  normalizeAffordabilityPolicy,
  type AffordabilityPolicy,
} from './affordability-policy';
import { isCollectionAction, THIRD_PARTY_OBLIGATIONS } from './movement-lexicon';
import {
  assessCoverage,
  buildMonthlySeries,
  classifyMovements,
  observationWindow,
  type AffordabilityTransaction,
  type ClassifiedMovement,
} from './monthly-series';
import { buildBalanceSeries, type BalanceSeries } from './balance-series';
import {
  assessEconomicPlausibility,
  CONCENTRATION_WINDOW_DAYS,
  type EconomicPlausibility,
} from './economic-plausibility';
import { findRecurringStreams, recognizableByCadence } from './recurrence';
import {
  clamp,
  coefficientOfVariation,
  median,
  relativeTrend,
  round2,
  round4,
  trimmedMean,
  winsorize,
} from './statistics';

/**
 * Versión del algoritmo. Viaja con cada evaluación.
 *
 * Sin ella, una capacidad de pago guardada hace tres meses y otra de hoy son dos
 * números que no se pueden comparar: no habría forma de saber si la diferencia
 * la produjo el cliente o un cambio en la fórmula. Se sube a mano y con
 * intención, como una versión de artefacto.
 */
export const AFFORDABILITY_MODEL_VERSION = '2.0.0';

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

// ---------------------------------------------------------------- ingreso

function assessIncome(
  scored: readonly MonthlyBucket[],
  movements: readonly ClassifiedMovement[],
  streams: readonly RecurringStream[],
  policy: AffordabilityPolicy,
): IncomeAssessment {
  const series = scored.map((month) => month.recognizedIncome);
  const medianIncome = median(series) ?? 0;
  const trimmed = trimmedMean(series) ?? 0;

  /*
   * La MENOR de las dos, siempre.
   *
   * Mediana y media recortada se separan justo cuando la serie es asimétrica, y
   * en un extracto la asimetría casi siempre es hacia arriba: el mes del
   * aguinaldo, el mes en que se cobró un trabajo grande. Quedarse con la mayor
   * sería dejar que ese mes decida; quedarse con la menor es la lectura que
   * sobrevive a que no se repita.
   */
  const recognized = Math.max(0, Math.min(medianIncome, trimmed));
  const variability = coefficientOfVariation(series);
  const trend = relativeTrend(series);

  /*
   * El castigo por volatilidad se suma al castigo por caída, y el segundo sólo
   * existe si la pendiente es NEGATIVA. Una tendencia al alza no premia: un
   * ingreso que sube tres meses puede seguir subiendo o puede ser el pico de una
   * temporada, y no hay forma de distinguirlo con tres puntos. Se es asimétrico a
   * propósito, en la dirección que no aprueba de más.
   */
  const volatilityHaircut = Math.min(policy.maximumIncomeHaircut, variability);
  const declineHaircut = trend < 0 ? Math.min(0.2, Math.abs(trend) * 3) : 0;
  const stressed = recognized * (1 - Math.min(0.6, volatilityHaircut + declineHaircut));

  const inflowTotal = movements
    .filter((movement) => movement.direction === 'INFLOW')
    .reduce((sum, movement) => sum + movement.amount, 0);
  const excluded = excludedInflows(movements);
  const topStream = streams[0]?.monthlyAmount ?? 0;

  return {
    monthlyRecognized: round2(recognized),
    median: round2(medianIncome),
    trimmedMean: round2(trimmed),
    stressed: round2(Math.max(0, stressed)),
    variability: round4(variability),
    stabilityScore: Math.round(clamp(1 - variability / 0.5, 0, 1) * 100),
    trend: round4(trend),
    concentration: recognized > 0 ? round4(clamp(topStream / recognized, 0, 1)) : 0,
    streams,
    excluded: {
      ...excluded,
      total_abonos: round2(inflowTotal),
    },
  };
}

/** Cuánto se descartó y por qué, para que la resta se pueda auditar. */
function excludedInflows(movements: readonly ClassifiedMovement[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const movement of movements) {
    if (movement.direction !== 'INFLOW') continue;
    if (
      movement.kind !== 'INTERNAL_TRANSFER' &&
      movement.kind !== 'REVERSAL' &&
      movement.kind !== 'CREDIT_DISBURSEMENT'
    ) {
      continue;
    }
    totals[movement.kind] = round2((totals[movement.kind] ?? 0) + movement.amount);
  }
  return totals;
}

// ---------------------------------------------------------------- gasto

function assessExpenses(
  scored: readonly MonthlyBucket[],
  policy: AffordabilityPolicy,
): ExpenseAssessment {
  /*
   * El gasto comprometido se WINSORIZA antes de sacar su mediana. El mes con la
   * matrícula del colegio o el seguro anual sigue contando —es un gasto real que
   * volverá— pero recortado al percentil 90 no fija él solo la línea base de los
   * doce meses siguientes. Eliminarlo fingiría que no ocurrió; dejarlo entero
   * convertiría un pago anual en un compromiso mensual.
   */
  const committedSeries = winsorize(scored.map((month) => month.committedSpend));
  const committed = median(committedSeries) ?? 0;
  const discretionary = median(scored.map((month) => month.discretionarySpend)) ?? 0;
  const effective = Math.max(committed, policy.subsistenceFloor);

  return {
    committedMonthly: round2(committed),
    effectiveMonthly: round2(effective),
    discretionaryMonthly: round2(discretionary),
    trend: round4(relativeTrend(scored.map((month) => month.committedSpend))),
    subsistenceFloorApplied: effective > committed,
  };
}

// ---------------------------------------------------------------- obligaciones

function assessObligations(
  scored: readonly MonthlyBucket[],
  streams: readonly RecurringStream[],
  income: number,
  externalDebtService: number | null,
): ObligationAssessment {
  const observed = median(scored.map((month) => month.thirdPartyObligations)) ?? 0;
  const recurring = streams
    .filter((stream) => THIRD_PARTY_OBLIGATIONS.has(stream.kind as never))
    .reduce((sum, stream) => sum + stream.monthlyAmount, 0);

  /*
   * La MAYOR de las dos, y aquí sí.
   *
   * La mediana mensual observada se queda corta cuando una cuota se cobra cada
   * dos meses o cuando el extracto empieza justo después del cobro; la suma de
   * los flujos recurrentes se queda corta cuando una cuota cambió de glosa y la
   * detección la partió en dos grupos. Tomar la mayor es la lectura prudente, y
   * la prudencia en las obligaciones va en dirección contraria a la prudencia en
   * el ingreso: allí se toma la menor. Las dos apuntan al mismo sitio — no
   * aprobar de más.
   */
  const observedMonthly = Math.max(observed, recurring);

  /*
   * Lo que se paga en OTRO banco no está en este extracto, y no vale cero.
   *
   * Es la distinción que el corpus fija en su caso `MISSING_DEBT` y la que más
   * fácil se pierde al escribir código: un dato que no llega se convierte en un
   * `?? 0` y, a partir de ahí, «no sabemos cuánto debe» y «no debe nada» son el
   * mismo número. Con esa confusión, la peor cartera posible —la de quien paga
   * tres cuotas en entidades que no vemos— sale con la mejor relación de
   * endeudamiento del sistema.
   *
   * Así que `externalDebtService` es `number | null` y nunca se rellena solo. Si
   * llega de un buró con consentimiento, suma; si no llega, lo que se publica
   * es que la cifra es un SUELO (`isLowerBound`), y quien decide lo sabe.
   */
  const monthly = round2(observedMonthly + (externalDebtService ?? 0));

  return {
    monthly,
    observedMonthly: round2(observedMonthly),
    externalDebtService: externalDebtService === null ? null : round2(externalDebtService),
    isLowerBound: externalDebtService === null,
    trend: round4(relativeTrend(scored.map((month) => month.thirdPartyObligations))),
    debtServiceRatio: income > 0 ? round4(clamp(monthly / income, 0, 5)) : 0,
    streams: streams.filter((stream) => THIRD_PARTY_OBLIGATIONS.has(stream.kind as never)),
  };
}

// ---------------------------------------------------------------- conducta

function assessSignals(
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

// ---------------------------------------------------------------- capacidad

function computeCapacity(
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

// ---------------------------------------------------------------- puntaje

/**
 * Cinco dimensiones, y ninguna puede compensar del todo a otra.
 *
 * El puntaje NO es la respuesta —eso lo decide la política— sino una síntesis
 * comparable entre expedientes. Las cinco están porque cada una describe una
 * forma distinta de no poder pagar: sin margen (holgura), con margen que no se
 * sostiene (estabilidad), con margen ya prometido a otro (carga), con margen
 * mensual pero sin dinero el día del cobro (liquidez), y con todo lo anterior
 * bien y una forma de administrar la cuenta que dice lo contrario (conducta).
 */
function computeScore(
  income: IncomeAssessment,
  obligations: ObligationAssessment,
  capacity: CapacityAssessment,
  signals: AffordabilityRiskSignals,
  policy: AffordabilityPolicy,
): number {
  const headroom =
    income.monthlyRecognized > 0 ? capacity.stressedDisposableIncome / income.monthlyRecognized : 0;
  // Un 35 % de holgura sobre el ingreso ya es un expediente holgado; por encima
  // deja de discriminar y el tramo se satura.
  const headroomScore = clamp(headroom / 0.35, 0, 1) * 100;
  const stabilityScore = income.stabilityScore;
  const burdenScore =
    clamp(1 - obligations.debtServiceRatio / policy.debtServiceToIncomeCap, 0, 1) * 100;
  const liquidityScore =
    signals.cashCushionDays === null
      ? 50
      : clamp(signals.cashCushionDays / policy.cashCushionTargetDays, 0, 1) * 100;

  const conductPenalty =
    Math.min(45, signals.nsfEvents * 15) +
    Math.min(30, signals.monthsEndingNegative * 10) +
    Math.min(30, signals.highRiskMonths * 10) +
    (signals.creditDisbursementsReceived > 0 && obligations.monthly > 0 ? 20 : 0) +
    (signals.collectionActions > 0 ? 25 : 0);
  const conductScore = clamp(100 - conductPenalty, 0, 100);

  const blended =
    headroomScore * 0.3 +
    stabilityScore * 0.2 +
    burdenScore * 0.2 +
    liquidityScore * 0.1 +
    conductScore * 0.2;

  // Las tendencias ajustan al final y poco: son direcciones, no niveles, y
  // dejarlas pesar como una dimensión más haría que tres meses de datos movieran
  // el puntaje por su pendiente antes que por su altura.
  const trendAdjustment = (income.trend < -0.03 ? -5 : 0) + (obligations.trend > 0.05 ? -5 : 0);

  return Math.round(clamp(blended + trendAdjustment, 0, 100));
}

/**
 * La banda, con un suelo duro: sin cuota que quepa no hay banda buena.
 *
 * Sin esta condición un expediente con ingreso estable, sin deudas y sin margen
 * —porque todo su ingreso se va en gasto esencial— podía salir `ADECUADA` por
 * puntaje. La banda tiene que ser coherente con la única cifra que después se
 * usa para prestar.
 */
function bandOf(score: number, capacity: CapacityAssessment): AffordabilityBand {
  if (capacity.maxAffordableInstallment <= 0) return 'INSUFICIENTE';
  if (score >= 75) return 'SOLIDA';
  if (score >= 55) return 'ADECUADA';
  if (score >= 35) return 'AJUSTADA';
  return 'INSUFICIENTE';
}

// ---------------------------------------------------------------- motivos

function explain(
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

function insufficientPeriodReason(complete: number, required: number): AffordabilityReason {
  return {
    code: 'AFF_PERIODO_INSUFICIENTE',
    severity: 'BLOCKING',
    message:
      `El extracto cubre ${String(complete)} mes(es) completo(s) y se necesitan ${String(required)}. ` +
      'Con menos meses, un ingreso extraordinario o un gasto puntual bastan para falsear el cálculo.',
    evidence: `${String(complete)}/${String(required)} meses`,
  };
}

function emptyAssessment(
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

export { DEFAULT_AFFORDABILITY_POLICY };
export type { AffordabilityPolicy, AffordabilityTransaction };
