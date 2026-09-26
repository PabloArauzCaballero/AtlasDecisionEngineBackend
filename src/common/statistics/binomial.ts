/**
 * Intervalos binomiales: cuánto se puede AFIRMAR a partir de lo que se midió.
 *
 * ## Por qué esto vive en `common/` y no dentro de un worker
 *
 * Porque los dos workers que miran documentos de una persona tienen el mismo
 * problema y lo tenían resuelto de la misma manera: no resolviéndolo. «El
 * clasificador acierta el 81 %» sobre 21 casos, «cero falsos positivos» sobre un
 * puñado de documentos, «el umbral es 0,8824». Las tres frases suenan a
 * medición y ninguna lo es, porque a ninguna la acompaña un denominador ni un
 * intervalo.
 *
 * Con 21 casos y 17 aciertos, el intervalo de Wilson al 95 % va de **0,60 a
 * 0,92**. Ese es el verdadero contenido de «81 %»: puede ser un clasificador
 * excelente o uno mediocre, y los datos no distinguen. Publicar el 81 % solo no
 * es optimismo, es una afirmación que los datos no sostienen.
 *
 * ## De dónde salen las fórmulas
 *
 * Del manual del NIST (Dataplot, *Exact Binomial Confidence Limits* y los
 * límites de Wilson/Agresti-Coull), que es lo que el corpus de identidad cita
 * como fuente OFICIAL. Las cifras que este archivo produce se comprueban contra
 * las tablas que el propio corpus trae calculadas: si una implementación se
 * desvía, la prueba lo dice.
 *
 * ## Qué NO hacen estos intervalos
 *
 * No arreglan una muestra sesgada. Un intervalo describe la incertidumbre de un
 * MUESTREO aleatorio de ensayos independientes; si los 300 documentos vienen de
 * siete clientes, el intervalo que salga de aquí será demasiado estrecho y
 * ninguna fórmula lo va a saber. El corpus lo dice de otra manera: «miles de
 * movimientos de siete clientes no sustituyen miles de clientes». La unidad
 * independiente hay que elegirla antes de contar.
 */

/** Un intervalo de confianza, con lo que hace falta para interpretarlo. */
export interface ConfidenceInterval {
  /** La proporción observada, `k/n`. */
  readonly point: number;
  readonly lower: number;
  readonly upper: number;
  /** Nivel de confianza, p. ej. 0,95. */
  readonly confidence: number;
  /** Aciertos/eventos observados. */
  readonly successes: number;
  /** Ensayos INDEPENDIENTES. Si no lo son, el intervalo miente por estrecho. */
  readonly trials: number;
  readonly method: 'WILSON' | 'CLOPPER_PEARSON';
}

/**
 * Cuantil de la normal estándar por la inversa de la función error.
 *
 * Aproximación racional de Acklam, con error relativo por debajo de 1,15e-9 en
 * todo el dominio — tres órdenes de magnitud por debajo de lo que importa aquí,
 * donde el tercer decimal de un intervalo ya no cambia ninguna decisión.
 */
export function normalQuantile(p: number): number {
  if (p <= 0 || p >= 1) throw new RangeError('normalQuantile espera 0 < p < 1');
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;

  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/** Logaritmo de la función gamma (Lanczos). Base de la beta incompleta. */
function logGamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const y = x - 1;
  let a = 0.99999999999980993;
  for (let i = 0; i < g.length; i += 1) a += g[i] / (y + i + 1);
  const t = y + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Beta incompleta regularizada `I_x(a, b)`, por fracción continua de Lentz.
 *
 * Es la función de distribución de la Beta, y con ella se calculan los límites
 * exactos de Clopper-Pearson: el límite superior con `k` errores sobre `n`
 * ensayos es el cuantil de una `Beta(k+1, n-k)`.
 */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  // La fracción continua converge rápido sólo en la mitad izquierda; al otro
  // lado se usa la simetría I_x(a,b) = 1 - I_(1-x)(b,a).
  if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBeta(1 - x, b, a);

  const tiny = 1e-30;
  let f = 1;
  let c = 1;
  let d = 0;
  for (let i = 0; i <= 300; i += 1) {
    const m = Math.floor(i / 2);
    let numerator: number;
    if (i === 0) numerator = 1;
    else if (i % 2 === 0) numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else numerator = -(((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1)));

    d = 1 + numerator * d;
    if (Math.abs(d) < tiny) d = tiny;
    d = 1 / d;
    c = 1 + numerator / c;
    if (Math.abs(c) < tiny) c = tiny;
    const step = c * d;
    f *= step;
    if (Math.abs(1 - step) < 1e-12) break;
  }
  return (front * (f - 1)) / a;
}

/** Cuantil de una Beta(a, b) por bisección sobre la beta incompleta. */
export function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2;
    if (incompleteBeta(mid, a, b) < p) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

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
