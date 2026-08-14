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

export interface FreshnessVerdict {
  observedAt: Date | null;
  fetchedAt: Date | null;
  sourceVersion: string | null;
  /** Antigüedad en segundos en el momento de decidir. Nulo si nadie declaró fecha. */
  ageSeconds: number | null;
  /** Está fuera de SLA. */
  stale: boolean;
  /** Hay que rechazar la ejecución. */
  reject: boolean;
  /** Se aceptó un valor viejo y hay que marcarlo. */
  degraded: boolean;
}

/**
 * Evalúa la frescura de un valor contra su SLA y su política.
 *
 * **Un dato sin fecha declarada NO se considera viejo.** Es la decisión de diseño discutible de
 * este módulo y va explicada: la inmensa mayoría de las integraciones vivas no mandan `observedAt`
 * todavía, y tratarlas como infinitamente viejas convertiría el estreno de esta comprobación en
 * una caída general del camino de decisión. Lo que sí ocurre es que `ageSeconds` queda nulo, y eso
 * se ve: la cobertura de sellos temporales es medible, y es lo que hay que subir antes de poder
 * exigir `REJECT` en serio.
 *
 * `slaSeconds <= 0` significa «sin SLA declarado» —es el valor con el que están sembradas casi
 * todas las fuentes— y no «tiene que ser instantáneo», que sería la lectura literal y dejaría
 * fuera todo.
 */
export function evaluateFreshness(
  input: FreshnessInput | undefined,
  slaSeconds: number,
  policy: FreshnessPolicy,
  now: Date = new Date(),
): FreshnessVerdict {
  const observedAt = toDate(input?.observedAt);
  const fetchedAt = toDate(input?.fetchedAt);
  const reference = observedAt ?? fetchedAt;
  const base: FreshnessVerdict = {
    observedAt,
    fetchedAt,
    sourceVersion: input?.sourceVersion?.trim() || null,
    ageSeconds: reference
      ? Math.max(0, Math.floor((now.getTime() - reference.getTime()) / 1_000))
      : null,
    stale: false,
    reject: false,
    degraded: false,
  };

  if (base.ageSeconds === null || slaSeconds <= 0) return base;
  if (base.ageSeconds <= slaSeconds) return base;

  const stale = { ...base, stale: true };
  if (policy === FreshnessPolicy.REJECT) return { ...stale, reject: true };
  if (policy === FreshnessPolicy.DEGRADE) return { ...stale, degraded: true };
  // IGNORE: se anota la antigüedad y no se marca nada. Sólo para variables que no deciden.
  return stale;
}

/**
 * Una fecha en el FUTURO no se acepta como sello.
 *
 * Un reloj adelantado en el sistema de origen produciría antigüedades negativas y, con ellas, un
 * dato eternamente fresco: exactamente el fallo que esta comprobación existe para impedir, y
 * además silencioso. Se descarta el sello y la variable queda como «sin fecha declarada», que es
 * visible en la cobertura.
 */
function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  // Un minuto de tolerancia por desfase de relojes entre máquinas, que es normal y no es un fallo.
  if (parsed.getTime() > Date.now() + 60_000) return null;
  return parsed;
}
