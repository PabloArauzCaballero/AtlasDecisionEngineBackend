import { ConfidenceInterval, betaQuantile, normalQuantile } from './distributions';

/**
 * Intervalo exacto de Clopper-Pearson.
 *
 * Es el conservador: cubre al menos el nivel declarado, a cambio de ser más
 * ancho que el nominal. Para una tasa de error que hay que poder DEFENDER —un
 * FMR, un APCER, una tasa de falsa acusación— esa asimetría es la correcta.
 */
export function clopperPearson(
  successes: number,
  trials: number,
  confidence = 0.95,
): ConfidenceInterval {
  validate(successes, trials, confidence);
  const alpha = 1 - confidence;
  const lower = successes === 0 ? 0 : betaQuantile(alpha / 2, successes, trials - successes + 1);
  const upper =
    successes === trials ? 1 : betaQuantile(1 - alpha / 2, successes + 1, trials - successes);
  return {
    point: trials === 0 ? 0 : successes / trials,
    lower,
    upper,
    confidence,
    successes,
    trials,
    method: 'CLOPPER_PEARSON',
  };
}

/**
 * Intervalo de Wilson.
 *
 * Se comporta mejor que el «normal» de manual en los extremos y con muestras
 * pequeñas, que es exactamente donde vive todo lo que este repositorio ha
 * medido hasta ahora. Es el que el corpus usa para interpretar el 81 % de 21
 * casos.
 */
export function wilson(successes: number, trials: number, confidence = 0.95): ConfidenceInterval {
  validate(successes, trials, confidence);
  const z = normalQuantile(1 - (1 - confidence) / 2);
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
  return {
    point: p,
    lower: Math.max(0, center - half),
    upper: Math.min(1, center + half),
    confidence,
    successes,
    trials,
    method: 'WILSON',
  };
}

/**
 * La cota superior cuando NO se observó ningún error: `1 − α^(1/n)`.
 *
 * Es la respuesta honesta a «no hemos tenido ni un falso positivo». Con 299
 * documentos auténticos y cero acusaciones, lo que se puede afirmar al 95 % es
 * que la tasa está por debajo del **0,997 %** — no que sea cero. Cero
 * observaciones de un suceso nunca demuestran que el suceso no ocurre.
 */
export function zeroErrorUpperBound(trials: number, confidence = 0.95): number {
  if (!Number.isInteger(trials) || trials <= 0) {
    throw new RangeError('zeroErrorUpperBound espera un número entero de ensayos mayor que cero');
  }
  const alpha = 1 - confidence;
  return 1 - Math.pow(alpha, 1 / trials);
}

/**
 * Cuántos ensayos hacen falta para poder afirmar una tasa objetivo sin errores.
 *
 * `ceil(log(α) / log(1 − p))`. Sirve para contestar la pregunta que precede a
 * cualquier calibración: para sostener un FMR de 1 entre 10.000 hacen falta
 * **23.025** comparaciones independientes sin un solo falso positivo. Saberlo
 * antes de empezar evita prometer lo que la muestra no va a poder demostrar.
 */
export function trialsForZeroErrors(targetRate: number, confidence = 0.95): number {
  if (targetRate <= 0 || targetRate >= 1) {
    throw new RangeError('trialsForZeroErrors espera 0 < tasa < 1');
  }
  const alpha = 1 - confidence;
  return Math.ceil(Math.log(alpha) / Math.log(1 - targetRate));
}

/**
 * La regla de tres: `2,995732 / n`, aproximación unilateral al 95 %.
 *
 * Es una aproximación cómoda para la cabeza, no una garantía ni una tasa
 * observada. Cuando importe, `zeroErrorUpperBound` da el número exacto.
 */
export function ruleOfThree(trials: number): number {
  if (trials <= 0) throw new RangeError('ruleOfThree espera ensayos mayores que cero');
  return 2.995732 / trials;
}

/**
 * Tamaño de muestra para una PRECISIÓN dada: `z²·p(1−p)/e²`.
 *
 * Con prevalencia desconocida se usa `p = 0,5`, que es el caso más exigente. Es
 * planificación, no una estimación de la tasa: el corpus lo separa explícitamente.
 */
export function sampleSizeForPrecision(
  expectedRate: number,
  halfWidth: number,
  confidence = 0.95,
): number {
  if (halfWidth <= 0) throw new RangeError('sampleSizeForPrecision espera un margen positivo');
  const z = normalQuantile(1 - (1 - confidence) / 2);
  return Math.ceil((z * z * expectedRate * (1 - expectedRate)) / (halfWidth * halfWidth));
}

/**
 * Ajuste por conglomerados y pérdida de seguimiento.
 *
 * `n · DEFF / seguimiento`. Existe porque la unidad independiente casi nunca es
 * la observación: treinta documentos de un mismo cliente son un cliente, y
 * tratarlos como treinta estrecha el intervalo por un factor que no es real.
 */
export function recruitmentSize(
  baseSize: number,
  designEffect: number,
  completeFollowUpFraction: number,
): number {
  if (completeFollowUpFraction <= 0 || completeFollowUpFraction > 1) {
    throw new RangeError('recruitmentSize espera una fracción de seguimiento en (0, 1]');
  }
  return Math.ceil((baseSize * designEffect) / completeFollowUpFraction);
}

function validate(successes: number, trials: number, confidence: number): void {
  if (!Number.isInteger(trials) || trials <= 0) {
    throw new RangeError('Se esperan ensayos enteros mayores que cero');
  }
  if (!Number.isInteger(successes) || successes < 0 || successes > trials) {
    throw new RangeError('Los aciertos tienen que estar entre 0 y el número de ensayos');
  }
  if (confidence <= 0 || confidence >= 1) {
    throw new RangeError('La confianza tiene que estar entre 0 y 1');
  }
}

/** Una frase honesta para acompañar a una tasa. Se usa en informes y trazas. */
export function describeInterval(interval: ConfidenceInterval): string {
  const pct = (value: number): string => `${(value * 100).toFixed(2)} %`;
  return (
    `${pct(interval.point)} (${interval.successes}/${interval.trials}); ` +
    `IC ${String(Math.round(interval.confidence * 100))} % ${pct(interval.lower)}–${pct(interval.upper)} ` +
    `[${interval.method === 'WILSON' ? 'Wilson' : 'Clopper-Pearson'}]`
  );
}
