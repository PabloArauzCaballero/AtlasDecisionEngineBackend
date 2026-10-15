import type { MonthlyBucket, ObligationAssessment, RecurringStream } from './affordability-model';
import { THIRD_PARTY_OBLIGATIONS } from './movement-lexicon';
import { clamp, median, relativeTrend, round2, round4 } from './statistics';

export function assessObligations(
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
