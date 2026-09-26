/**
 * Poder discriminante y calibración: las dos preguntas que `summarizePerformance` no responde.
 *
 * Aquélla mide `discrimination` con una separación de medias, que es barata y estable con pocos
 * casos y sirve para ver una TENDENCIA. Estas dos son las medidas publicables, y son distintas
 * entre sí de una forma que se confunde a menudo:
 *
 *  - **Discriminación** (KS, AUC/Gini) — ¿ordena bien? ¿los malos salen arriba?
 *  - **Calibración** — ¿el NIVEL es correcto? ¿cuando dice 5 % falla el 5 %?
 *
 * Un modelo puede ordenar perfectamente y estar descalibrado por un factor de tres. Mientras la
 * decisión sea sí/no con un corte, sólo importa la primera; en cuanto la PD entra en el precio o
 * en la pérdida esperada, la segunda se convierte en dinero. Por eso el gate del contrato
 * económico exige cosecha observada antes de dejar que una PD alimente el precio.
 *
 * Funciones puras: reciben filas y devuelven números, para que la aritmética se pueda verificar
 * con casos escritos a mano. Una tasa mal calculada no falla, miente.
 */

/** Un caso con su puntaje y si resultó malo. El insumo mínimo de las dos medidas. */
export interface ScoredOutcome {
  /** Puntaje donde MÁS ALTO = MÁS RIESGO. Si el artefacto publica al revés, se invierte antes. */
  score: number;
  bad: boolean;
}

export interface DiscriminationResult {
  /** Casos utilizables: con puntaje finito y desenlace concluyente. */
  usable: number;
  bad: number;
  good: number;
  /**
   * Kolmogorov-Smirnov: la separación máxima entre las dos acumuladas. 0 = no distingue.
   * En crédito, por encima de 0,3 se considera utilizable y por encima de 0,5 muy bueno.
   */
  ks: number | null;
  /**
   * Área bajo la curva ROC. 0,5 = azar. Se calcula por el estadístico de Mann-Whitney y no
   * integrando la curva: con empates —y en crédito hay muchos, los puntajes son enteros— la
   * integración por trapecios los reparte mal y el número sale optimista.
   */
  auc: number | null;
  /** Gini = 2·AUC − 1. Es lo que pide un comité de riesgo; se da hecho para que nadie lo derive mal. */
  gini: number | null;
}

/**
 * KS, AUC y Gini sobre una muestra observada.
 *
 * Devuelve `null` en las tres cuando falta una de las dos clases. No es un caso de borde
 * académico: una cartera joven puede no tener ni un solo malo todavía, y ahí un AUC de 0,5
 * —«el modelo no distingue nada»— sería una conclusión falsa sobre un modelo del que aún no se
 * sabe nada. La diferencia entre «malo» y «desconocido» es justo lo que este módulo cuida.
 */
export function discrimination(samples: ScoredOutcome[]): DiscriminationResult {
  const usable = samples.filter((sample) => Number.isFinite(sample.score));
  const bads = usable.filter((sample) => sample.bad).map((sample) => sample.score);
  const goods = usable.filter((sample) => !sample.bad).map((sample) => sample.score);
  const base = { usable: usable.length, bad: bads.length, good: goods.length };
  if (!bads.length || !goods.length) return { ...base, ks: null, auc: null, gini: null };

  const auc = mannWhitneyAuc(bads, goods);
  return {
    ...base,
    ks: kolmogorovSmirnov(bads, goods),
    auc: round(auc),
    gini: round(2 * auc - 1),
  };
}

/**
 * AUC por Mann-Whitney con rangos medios en los empates.
 *
 * La fórmula: AUC = (R − n·(n+1)/2) / (n·m), donde R es la suma de rangos de los malos. Los
 * empates reciben el rango MEDIO del grupo empatado, que es exactamente el crédito parcial que
 * les corresponde: si un malo y un bueno tienen el mismo puntaje, el modelo no los distingue y
 * debe puntuar 0,5 en ese par, no 1.
 */
function mannWhitneyAuc(bads: number[], goods: number[]): number {
  const all = [
    ...bads.map((score) => ({ score, bad: true })),
    ...goods.map((score) => ({ score, bad: false })),
  ];
  all.sort((left, right) => left.score - right.score);

  const ranks = new Array<number>(all.length);
  let index = 0;
  while (index < all.length) {
    let last = index;
    while (last + 1 < all.length && all[last + 1].score === all[index].score) last += 1;
    // Rango medio del bloque empatado, en base 1.
    const shared = (index + last + 2) / 2;
    for (let position = index; position <= last; position += 1) ranks[position] = shared;
    index = last + 1;
  }

  let rankSumOfBads = 0;
  for (let position = 0; position < all.length; position += 1) {
    if (all[position].bad) rankSumOfBads += ranks[position];
  }
  const n = bads.length;
  const m = goods.length;
  return (rankSumOfBads - (n * (n + 1)) / 2) / (n * m);
}

/** Máxima distancia entre las acumuladas de malos y buenos, evaluada en cada puntaje distinto. */
function kolmogorovSmirnov(bads: number[], goods: number[]): number {
  const cuts = [...new Set([...bads, ...goods])].sort((left, right) => left - right);
  let maximum = 0;
  for (const cut of cuts) {
    const badShare = bads.filter((score) => score <= cut).length / bads.length;
    const goodShare = goods.filter((score) => score <= cut).length / goods.length;
    maximum = Math.max(maximum, Math.abs(badShare - goodShare));
  }
  return round(maximum);
}

export interface CalibrationDecile {
  decile: number;
  predictedRate: number;
  observedRate: number;
  sampleSize: number;
}

export interface CalibrationResult {
  buckets: CalibrationDecile[];
  /**
   * Hosmer-Lemeshow. Compara predicho contra observado decil a decil; cuanto MÁS GRANDE, peor
   * calibrado. Con 8 grados de libertad, por encima de ~15,5 se rechaza la hipótesis de buen
   * ajuste al 95 %.
   */
  hosmerLemeshow: number | null;
  /** Sesgo global: predicho medio menos observado medio. Positivo = el modelo es pesimista. */
  meanBias: number | null;
}

/**
 * Curva de calibración por deciles de PD predicha.
 *
 * Los deciles se cortan por CANTIDAD DE CASOS y no por tramos iguales de probabilidad. La razón es
 * la forma real de una cartera: casi todo se concentra en PD bajas, así que con tramos de ancho
 * fijo los nueve primeros saldrían vacíos y el décimo tendría el 90 % de la muestra — una curva
 * de un punto, dibujada como si tuviera diez.
 */
export function calibration(
  samples: Array<{ predicted: number; bad: boolean }>,
): CalibrationResult {
  const usable = samples
    .filter(
      (sample) =>
        Number.isFinite(sample.predicted) && sample.predicted >= 0 && sample.predicted <= 1,
    )
    .sort((left, right) => left.predicted - right.predicted);
  if (usable.length < 10) return { buckets: [], hosmerLemeshow: null, meanBias: null };

  const buckets: CalibrationDecile[] = [];
  const size = usable.length / 10;
  for (let decile = 1; decile <= 10; decile += 1) {
    const slice = usable.slice(Math.floor((decile - 1) * size), Math.floor(decile * size));
    if (!slice.length) continue;
    buckets.push({
      decile,
      predictedRate: round(
        slice.reduce((total, sample) => total + sample.predicted, 0) / slice.length,
      ),
      observedRate: round(slice.filter((sample) => sample.bad).length / slice.length),
      sampleSize: slice.length,
    });
  }

  let statistic = 0;
  for (const bucket of buckets) {
    const expected = bucket.predictedRate * bucket.sampleSize;
    const observed = bucket.observedRate * bucket.sampleSize;
    const variance = expected * (1 - bucket.predictedRate);
    // Un decil donde el modelo predice 0 % o 100 % tiene varianza nula: el término explotaría y
    // haría infinito el estadístico entero. Se omite, que es lo que hace cualquier
    // implementación seria, y el `sampleSize` de la respuesta deja ver sobre qué se calculó.
    if (variance <= 0) continue;
    statistic += (observed - expected) ** 2 / variance;
  }

  const predictedMean =
    usable.reduce((total, sample) => total + sample.predicted, 0) / usable.length;
  const observedMean = usable.filter((sample) => sample.bad).length / usable.length;
  return {
    buckets,
    hosmerLemeshow: round(statistic),
    meanBias: round(predictedMean - observedMean),
  };
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
