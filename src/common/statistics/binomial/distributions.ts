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
