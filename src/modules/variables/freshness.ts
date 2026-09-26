/**
 * Cuándo un dato es demasiado viejo para decidir con él.
 *
 * `freshnessSlaSeconds` se declaraba en `decision_variable_source` desde el primer día del
 * esquema y **no se imponía en ninguna parte**: una variable con SLA de 60 s se aceptaba con un
 * valor de hace tres días y nadie se enteraba de nada. El campo estaba, la intención estaba, y el
 * efecto era cero — que es la forma más cara de tener un control, porque se cree que existe.
 *
 * Para microcrédito importa más que en otros dominios. La señal que de verdad discrimina cuando el
 * buró está vacío es el comportamiento —saldos, movimientos, mora—, y esa señal cambia todos los
 * días. Un dato viejo aquí no es «menos preciso»: es la respuesta a otra pregunta.
 *
 * Funciones puras, sin Prisma ni Nest: lo que hay que poder verificar es la aritmética de la
 * antigüedad y la tabla de decisión, no que una consulta traiga las filas.
 */
import { FreshnessPolicy } from '@prisma/client';

/** Lo que el llamante declara sobre la procedencia temporal de un valor. */
export interface FreshnessInput {
  /** Cuándo era cierto el valor, según quien lo entrega. */
  observedAt?: Date | string | null;
  /** Cuándo se obtuvo. Sólo se usa si no hay `observedAt`. */
  fetchedAt?: Date | string | null;
  sourceVersion?: string | null;
}

/** Qué se sabe del sello temporal declarado, separado de si el dato es viejo. */
export type TimestampStatus = 'PRESENT' | 'ABSENT' | 'INVALID' | 'FUTURE';

/**
 * Qué hacer con una variable CRÍTICA cuya frescura no se puede comprobar (sin sello o sin SLA).
 *
 * `DEGRADE` por omisión: la decisión se toma, pero sale marcada (`degradedInputs`,
 * `freshnessUnknown`) y quien concede no debe originar con ella. `REJECT` la convierte en
 * `NO_DECISION`. `MEASURE` sólo anota: existe para poder bajar el ruido de forma VISIBLE mientras
 * los integradores empiezan a mandar sellos, nunca como valor por omisión.
 */
export type UnknownFreshnessPolicy = 'REJECT' | 'DEGRADE' | 'MEASURE';

export const UNKNOWN_FRESHNESS_POLICIES: readonly UnknownFreshnessPolicy[] = [
  'REJECT',
  'DEGRADE',
  'MEASURE',
];

/** Motivo estable de un veredicto que rechaza o degrada. */
export type FreshnessReason =
  'STALE' | 'TIMESTAMP_FUTURE' | 'TIMESTAMP_INVALID' | 'FRESHNESS_UNKNOWN' | 'SLA_NOT_DECLARED';

export interface FreshnessVerdict {
  observedAt: Date | null;
  fetchedAt: Date | null;
  sourceVersion: string | null;
  /** Antigüedad en segundos en el momento de decidir. Nulo si no hay sello válido. */
  ageSeconds: number | null;
  /** Estado del sello declarado. Una fecha futura o ilegible NO se convierte en «sin fecha». */
  timestampStatus: TimestampStatus;
  /** Variable crítica cuya frescura no se pudo comprobar (sin sello válido o sin SLA positivo). */
  unknown: boolean;
  /** Está fuera de SLA. */
  stale: boolean;
  /** Hay que rechazar la ejecución. */
  reject: boolean;
  /** Se aceptó un valor dudoso y hay que marcarlo. */
  degraded: boolean;
  /** Por qué se rechaza o degrada. Nulo si no pasa ninguna de las dos cosas. */
  reason: FreshnessReason | null;
}

export interface FreshnessOptions {
  /** Ver `UnknownFreshnessPolicy`. Por omisión `DEGRADE`. */
  unknownPolicy?: UnknownFreshnessPolicy;
}

/**
 * Evalúa la frescura de un valor contra su SLA y su política, con el reloj de la decisión.
 *
 * Cuatro situaciones distintas, cada una con su tratamiento explícito:
 *
 *  - **Sello futuro o ilegible.** No es «sin fecha»: es un sello en el que no se puede confiar, y
 *    tratarlo como ausente lo volvía silenciosamente aceptable. Se aplica la política de la
 *    variable (`REJECT` rechaza, `DEGRADE` marca, `IGNORE` sólo lo anota), haya SLA o no.
 *  - **Variable crítica (`REJECT`) sin sello o sin SLA positivo.** Su frescura es DESCONOCIDA. Se
 *    marca `unknown` y se aplica `options.unknownPolicy`. Una variable de la que depende la
 *    decisión y no declara compromiso de frescura no puede darse por fresca.
 *  - **Variable no crítica sin sello o sin SLA.** No hay compromiso que comprobar: se anota y
 *    sigue, como antes. `slaSeconds <= 0` significa «sin SLA declarado».
 *  - **Sello válido y SLA positivo.** Se compara la antigüedad; fuera de SLA, `stale` y la
 *    política de la variable.
 *
 * `now` es el reloj de la decisión y se usa TAMBIÉN para decidir qué es futuro: consultar
 * `Date.now()` aquí dentro hacía que una prueba con el reloj fijado —o una decisión que se
 * reevalúa— diera por fresco un sello posterior a su propio instante.
 */
export function evaluateFreshness(
  input: FreshnessInput | undefined,
  slaSeconds: number,
  policy: FreshnessPolicy,
  now: Date = new Date(),
  options: FreshnessOptions = {},
): FreshnessVerdict {
  const observed = parseStamp(input?.observedAt, now);
  const fetched = parseStamp(input?.fetchedAt, now);
  const reference = observed.date ?? fetched.date;
  const timestampStatus: TimestampStatus =
    observed.status === 'FUTURE' || fetched.status === 'FUTURE'
      ? 'FUTURE'
      : observed.status === 'INVALID' || fetched.status === 'INVALID'
        ? 'INVALID'
        : reference
          ? 'PRESENT'
          : 'ABSENT';
  const base: FreshnessVerdict = {
    observedAt: observed.date,
    fetchedAt: fetched.date,
    sourceVersion: input?.sourceVersion?.trim() || null,
    ageSeconds:
      timestampStatus === 'PRESENT' && reference
        ? Math.max(0, Math.floor((now.getTime() - reference.getTime()) / 1_000))
        : null,
    timestampStatus,
    unknown: false,
    stale: false,
    reject: false,
    degraded: false,
    reason: null,
  };

  if (timestampStatus === 'FUTURE' || timestampStatus === 'INVALID') {
    const reason: FreshnessReason =
      timestampStatus === 'FUTURE' ? 'TIMESTAMP_FUTURE' : 'TIMESTAMP_INVALID';
    if (policy === FreshnessPolicy.REJECT) return { ...base, reject: true, reason };
    if (policy === FreshnessPolicy.DEGRADE) return { ...base, degraded: true, reason };
    return base;
  }

  const critical = policy === FreshnessPolicy.REJECT;
  if (critical && (slaSeconds <= 0 || base.ageSeconds === null)) {
    const reason: FreshnessReason = slaSeconds <= 0 ? 'SLA_NOT_DECLARED' : 'FRESHNESS_UNKNOWN';
    const unknownPolicy = options.unknownPolicy ?? 'DEGRADE';
    const unknown = { ...base, unknown: true };
    if (unknownPolicy === 'REJECT') return { ...unknown, reject: true, reason };
    if (unknownPolicy === 'DEGRADE') return { ...unknown, degraded: true, reason };
    return unknown;
  }

  if (base.ageSeconds === null || slaSeconds <= 0) return base;
  if (base.ageSeconds <= slaSeconds) return base;

  const stale = { ...base, stale: true };
  if (policy === FreshnessPolicy.REJECT) return { ...stale, reject: true, reason: 'STALE' };
  if (policy === FreshnessPolicy.DEGRADE) return { ...stale, degraded: true, reason: 'STALE' };
  // IGNORE: se anota la antigüedad y no se marca nada. Sólo para variables que no deciden.
  return stale;
}

/** Lee la política de frescura desconocida de la configuración; un valor raro cae en DEGRADE. */
export function parseUnknownFreshnessPolicy(raw: unknown): UnknownFreshnessPolicy {
  const value = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return (UNKNOWN_FRESHNESS_POLICIES as readonly string[]).includes(value)
    ? (value as UnknownFreshnessPolicy)
    : 'DEGRADE';
}

/**
 * Interpreta un sello contra el reloj de la decisión.
 *
 * Una fecha más de un minuto posterior a `now` es FUTURA: un reloj adelantado en el origen
 * produciría antigüedades negativas y, con ellas, un dato eternamente fresco. El minuto de
 * tolerancia absorbe el desfase normal entre máquinas. Futura o ilegible, la fecha se descarta
 * como sello pero el estado se conserva: descartarla en silencio era convertirla en «sin fecha»,
 * que para una variable no crítica equivale a aceptarla.
 */
function parseStamp(
  value: Date | string | null | undefined,
  now: Date,
): { date: Date | null; status: TimestampStatus } {
  if (value === null || value === undefined || value === '') {
    return { date: null, status: 'ABSENT' };
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return { date: null, status: 'INVALID' };
  if (parsed.getTime() > now.getTime() + 60_000) return { date: null, status: 'FUTURE' };
  return { date: parsed, status: 'PRESENT' };
}
