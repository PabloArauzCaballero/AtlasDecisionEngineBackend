/**
 * Implementaciones reales detrás de cada librería autorizada (§7).
 *
 * Decisión de diseño deliberada: el prelude NO se guarda en la base de datos. Una fila
 * de `decision_approved_library` solo puede HABILITAR un prelude que ya existe en este
 * archivo, revisado y versionado en el repositorio. Si el registro pudiera aportar el
 * código, aprobar una librería sería equivalente a inyectar código en el sandbox y el
 * "registro de librerías autorizadas" dejaría de ser un control de seguridad.
 *
 * Tampoco hay `import` ni `require`: el prelude es texto que se evalúa DENTRO del
 * sandbox, sujeto a sus mismas restricciones.
 *
 * En Python las funciones se exponen con nombre plano y prefijo (`math_abs`) en vez de
 * como atributos de un objeto: el runner de Python prohíbe `class` y el acceso a
 * atributos dunder, así que un espacio de nombres con puntos no sobreviviría a su
 * análisis estático.
 */
export interface LibraryPrelude {
  javascript?: { source: string; functions: string[] };
  python?: { source: string; functions: string[] };
}

const MATH: LibraryPrelude = {
  javascript: {
    functions: [
      'math.abs',
      'math.round',
      'math.floor',
      'math.ceil',
      'math.min',
      'math.max',
      'math.pow',
      'math.sqrt',
      'math.log',
      'math.exp',
      'math.trunc',
    ],
    source: `const math = Object.freeze({
  abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  min: Math.min, max: Math.max, pow: Math.pow, sqrt: Math.sqrt,
  log: Math.log, exp: Math.exp, trunc: Math.trunc,
});`,
  },
  python: {
    functions: [
      'math_abs',
      'math_round',
      'math_floor',
      'math_ceil',
      'math_min',
      'math_max',
      'math_pow',
      'math_sqrt',
      'math_trunc',
    ],
    source: `math_abs = abs
math_round = round
math_min = min
math_max = max
def math_floor(x):
    return int(x // 1)
def math_ceil(x):
    return int(-((-x) // 1))
def math_pow(base, exponent):
    return base ** exponent
def math_sqrt(x):
    return x ** 0.5
def math_trunc(x):
    return int(x)`,
  },
};

const STATISTICS: LibraryPrelude = {
  javascript: {
    functions: [
      'statistics.mean',
      'statistics.median',
      'statistics.stdev',
      'statistics.variance',
      'statistics.total',
    ],
    source: `const statistics = Object.freeze({
  total: (v) => v.reduce((a, b) => a + b, 0),
  mean: (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null),
  median: (v) => { const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
    return !s.length ? null : (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2); },
  variance: (v) => { if (!v.length) return null; const m = v.reduce((a, b) => a + b, 0) / v.length;
    return v.reduce((t, x) => t + (x - m) ** 2, 0) / v.length; },
  stdev: (v) => { if (!v.length) return null; const m = v.reduce((a, b) => a + b, 0) / v.length;
    return Math.sqrt(v.reduce((t, x) => t + (x - m) ** 2, 0) / v.length); },
});`,
  },
  python: {
    functions: ['stats_total', 'stats_mean', 'stats_median', 'stats_variance', 'stats_stdev'],
    source: `stats_total = sum
def stats_mean(v):
    return (sum(v) / len(v)) if len(v) else None
def stats_median(v):
    s = sorted(v)
    m = len(s) // 2
    return None if not s else (s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2)
def stats_variance(v):
    if not len(v):
        return None
    mu = sum(v) / len(v)
    return sum((x - mu) ** 2 for x in v) / len(v)
def stats_stdev(v):
    var = stats_variance(v)
    return None if var is None else var ** 0.5`,
  },
};

const FINANCE: LibraryPrelude = {
  javascript: {
    functions: ['finance.dti', 'finance.ltv', 'finance.simpleInterest', 'finance.monthlyPayment'],
    source: `const finance = Object.freeze({
  dti: (debt, income) => (income > 0 ? debt / income : null),
  ltv: (loan, value) => (value > 0 ? loan / value : null),
  simpleInterest: (principal, rate, periods) => principal * rate * periods,
  monthlyPayment: (principal, monthlyRate, months) => (monthlyRate === 0
    ? (months > 0 ? principal / months : null)
    : (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months))),
});`,
  },
  python: {
    functions: ['finance_dti', 'finance_ltv', 'finance_simple_interest', 'finance_monthly_payment'],
    source: `def finance_dti(debt, income):
    return (debt / income) if income > 0 else None
def finance_ltv(loan, value):
    return (loan / value) if value > 0 else None
def finance_simple_interest(principal, rate, periods):
    return principal * rate * periods
def finance_monthly_payment(principal, rate, months):
    if rate == 0:
        return (principal / months) if months > 0 else None
    return (principal * rate) / (1 - (1 + rate) ** (-months))`,
  },
};

/** Cálculos entre fechas provistas. No hay acceso al reloj: eso rompería el determinismo. */
const DATES: LibraryPrelude = {
  javascript: {
    functions: ['dates.daysBetween', 'dates.yearsBetween'],
    source: `const dates = Object.freeze({
  daysBetween: (a, b) => Math.floor((Date.parse(b) - Date.parse(a)) / 86400000),
  yearsBetween: (a, b) => Math.floor((Date.parse(b) - Date.parse(a)) / 31557600000),
});`,
  },
  python: {
    functions: ['dates_days_between', 'dates_years_between'],
    source: `def _epoch_days(text):
    y, m, d = int(text[0:4]), int(text[5:7]), int(text[8:10])
    a = (14 - m) // 12
    yy = y + 4800 - a
    mm = m + 12 * a - 3
    return d + (153 * mm + 2) // 5 + 365 * yy + yy // 4 - yy // 100 + yy // 400 - 32045
def dates_days_between(a, b):
    return _epoch_days(b) - _epoch_days(a)
def dates_years_between(a, b):
    return (_epoch_days(b) - _epoch_days(a)) // 365`,
  },
};

/**
 * Índice por nombre de paquete. Habilitar una librería en el registro sin entrada aquí
 * es un error de configuración y el validador lo rechaza (fail-closed).
 */
export const LIBRARY_PRELUDES: Readonly<Record<string, LibraryPrelude>> = {
  math: MATH,
  statistics: STATISTICS,
  finance: FINANCE,
  dates: DATES,
};

export type PreludeLanguage = 'JAVASCRIPT' | 'PYTHON';

/**
 * Construye el prelude completo para un lenguaje a partir de los paquetes habilitados.
 * Devuelve `null` si alguno no tiene implementación registrada para ese lenguaje.
 */
export function buildPrelude(
  packageNames: readonly string[],
  language: PreludeLanguage,
): string | null {
  const parts: string[] = [];
  for (const name of packageNames) {
    const source = preludeFor(name, language)?.source;
    if (!source) return null;
    parts.push(source);
  }
  return parts.join('\n');
}

/** Funciones que quedan disponibles con estos paquetes, en este lenguaje. */
export function allowedFunctionsFor(
  packageNames: readonly string[],
  language: PreludeLanguage,
): string[] {
  return packageNames.flatMap((name) => preludeFor(name, language)?.functions ?? []);
}

export function isPreludeAvailable(packageName: string, language: PreludeLanguage): boolean {
  return Boolean(preludeFor(packageName, language));
}

function preludeFor(
  packageName: string,
  language: PreludeLanguage,
): { source: string; functions: string[] } | undefined {
  const prelude = LIBRARY_PRELUDES[packageName];
  if (!prelude) return undefined;
  return language === 'PYTHON' ? prelude.python : prelude.javascript;
}
