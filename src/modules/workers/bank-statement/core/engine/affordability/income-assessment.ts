import type { ClassifiedMovement } from './monthly-series';
import type { IncomeAssessment, MonthlyBucket, RecurringStream } from './affordability-model';
import type { AffordabilityPolicy } from './affordability-policy';
import {
  clamp,
  coefficientOfVariation,
  median,
  relativeTrend,
  round2,
  round4,
  trimmedMean,
} from './statistics';

export function assessIncome(
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
export function excludedInflows(movements: readonly ClassifiedMovement[]): Record<string, number> {
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
