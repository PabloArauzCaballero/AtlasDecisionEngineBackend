/**
 * La CUARTA compuerta: **cuándo** termina el extracto.
 *
 * Las tres anteriores preguntan por el archivo (contenedor), por el contenido
 * (clasificador) y por quién lo firma (padrón). Ninguna pregunta lo único que
 * caduca: un extracto auténtico, de un banco con licencia, con sus tres meses
 * completos y cerrado en marzo describe una vida financiera que ya no existe.
 * Se admitía sin objeción, y la capacidad de pago que salía de él se publicaba
 * como si fuera de hoy.
 *
 * ## Por qué se mide el FINAL de la ventana y no el principio
 *
 * Porque lo que caduca es el borde derecho. Que el extracto empiece hace ocho
 * meses no lo empeora —es más historia, y la política de meses ya exige un
 * mínimo—; que termine hace ocho meses lo invalida entero. Medir el inicio
 * castigaría justo al documento más informativo.
 *
 * ## Por qué hay tolerancia, y por qué son tres días
 *
 * Porque «hasta hoy» no existe en ningún banco. La banca por internet cierra el
 * extracto en el último movimiento, no en el instante de la descarga: un fin de
 * semana sin movimientos, un feriado, o una cuenta que sencillamente no se usó
 * el martes dejan el último apunte dos o tres días atrás sin que el documento
 * tenga nada de malo. Sin tolerancia, la compuerta rechazaría a quien descarga
 * su extracto un lunes por la mañana.
 *
 * ## Dos maneras de estar vigente (Pablo, 2026-10-16: «que cuadren»)
 *
 * Hasta el 2026-10-16 sólo valía un extracto «hasta hoy» (último movimiento con
 * tres días como mucho). Pero la app —y cualquier banca por internet— ofrece
 * «los últimos 3 meses completos»: quien descargaba de julio a septiembre el
 * 16 de octubre, exactamente lo que se le pidió, recibía «extracto vencido».
 * Ahora se admite también el extracto que cierra al FINAL DEL ÚLTIMO MES
 * NATURAL COMPLETO, con la misma tolerancia de tres días hacia atrás:
 *
 * - hoy 16/10 → el último mes completo cierra el 30/09; se admite un cierre del
 *   27/09 en adelante (un fin de mes en domingo deja el último apunte el jueves);
 * - un cierre del 30/04 sigue siendo STALE: describe una vida de hace medio año.
 *
 * «El mes anterior» se mide en la hora de BOLIVIA (America/La_Paz), no en UTC:
 * el 1 de octubre a las 22:00 en La Paz ya son las 02:00 del 2 en UTC, pero para
 * la persona sigue siendo el 1 y su último mes completo es septiembre. Al revés,
 * a las 23:00 del 30/09 en La Paz el mes completo todavía es agosto. La
 * antigüedad en días (`ageDays`) se sigue midiendo en días UTC, como antes.
 *
 * ## Por qué una fecha FUTURA va a revisión y no al rechazo
 *
 * Porque la causa más frecuente no es el fraude: es `03/04/2026` leído como 3 de
 * abril cuando el banco quiso decir 4 de marzo. El día que el motor confunde el
 * orden de día y mes, el síntoma es exactamente éste, y rechazar convertiría un
 * defecto de lectura en una acusación al cliente. La ambigüedad va a una
 * persona; la evidencia positiva es la que cierra casos.
 */

import type { DocumentVerdict } from '../document-triage';

export type RecencyVerdict = 'CURRENT' | 'STALE' | 'FUTURE_DATED' | 'UNDATED';

export interface RecencyAssessment {
  readonly verdict: RecencyVerdict;
  /** Qué hacer con el documento, en la misma escala que las otras compuertas. */
  readonly disposition: DocumentVerdict;
  /** Último día cubierto por la ventana observada, o `null` si no se pudo leer. */
  readonly periodTo: string | null;
  /**
   * Días entre el último día cubierto y hoy. Negativo si el extracto termina en
   * el futuro. `null` cuando no hay fecha que medir.
   */
  readonly ageDays: number | null;
  /** Día contra el que se midió. Viaja para que la traza sea reproducible. */
  readonly evaluatedOn: string;
  /** Por qué. Queda en la traza y en el detalle del error. */
  readonly reasons: readonly string[];
}

export interface RecencyGateOptions {
  /**
   * Si un extracto vencido se rechaza de verdad.
   *
   * Está aquí, y no compilado a `true`, por el mismo motivo que en las otras
   * tres compuertas: encender una exigencia nueva sobre un motor en marcha
   * rechaza documentos que ayer pasaban, y esa decisión es de quien opera. Con
   * `false` la compuerta mide, deja constancia y no bloquea.
   */
  readonly enforce: boolean;
  /**
   * Días que puede llevar cerrado el extracto y seguir describiendo el presente.
   *
   * Tres. Es el hueco que deja un fin de semana largo entre el último movimiento
   * y la descarga, y es la razón de que no sea cero.
   */
  readonly toleranceDays: number;
  /**
   * Días que la ventana puede adelantarse a hoy antes de considerarse imposible.
   *
   * Simétrico a `toleranceDays` a propósito: el mismo desfase de calendario que
   * explica un extracto de hace tres días explica uno fechado tres días
   * adelante —una zona horaria, un banco que fecha el asiento del día siguiente—.
   * Más allá, la fecha no describe ningún hecho ocurrido.
   */
  readonly futureToleranceDays: number;
  /**
   * De dónde sale «hoy».
   *
   * Inyectable porque una compuerta que lee el reloj del proceso no se puede
   * probar: su resultado cambiaría cada día que pasa, y la prueba que hoy
   * demuestra la vigencia mañana demostraría la caducidad. También permite
   * reevaluar un documento contra la fecha en que se recibió, y no contra la de
   * hoy, cuando se reprocesa una cola atrasada.
   */
  readonly now: () => Date;
}

export const DEFAULT_RECENCY_OPTIONS: RecencyGateOptions = {
  enforce: true,
  toleranceDays: 3,
  futureToleranceDays: 3,
  now: () => new Date(),
};

const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * Evalúa la vigencia de la ventana observada.
 *
 * @param periodTo Último día cubierto, en `AAAA-MM-DD`. Se toma de la cobertura
 * —y no de la carátula— porque es la ventana que el análisis usó de verdad: una
 * carátula que promete «hasta el 31 de agosto» sobre un documento cuyo último
 * apunte es de mayo no describe agosto, lo anuncia.
 */
export function assessRecency(
  periodTo: string | null | undefined,
  options: RecencyGateOptions = DEFAULT_RECENCY_OPTIONS,
): RecencyAssessment {
  const today = startOfUtcDay(options.now());
  const evaluatedOn = isoDay(today);
  const last = parseIsoDate(periodTo);

  if (!last) {
    return {
      verdict: 'UNDATED',
      // Sin fecha no hay afirmación posible: ni que está vigente ni que caducó.
      // Es exactamente el estado para el que existe la revisión humana.
      disposition: 'REVIEW',
      periodTo: null,
      ageDays: null,
      evaluatedOn,
      reasons: ['sin-fecha-de-cierre'],
    };
  }

  const ageDays = Math.round((today.getTime() - last.getTime()) / MILLISECONDS_PER_DAY);
  const base = { periodTo: isoDay(last), ageDays, evaluatedOn };

  if (ageDays < -options.futureToleranceDays) {
    return {
      ...base,
      verdict: 'FUTURE_DATED',
      disposition: 'REVIEW',
      reasons: [`cierre-en-el-futuro:${String(-ageDays)}d`, 'posible-orden-de-fecha-invertido'],
    };
  }

  // El último mes natural completo, visto desde Bolivia, y su cierre con la tolerancia.
  const lastMonthEnd = lastCompleteMonthEnd(options.now());
  const monthEndThreshold = new Date(
    lastMonthEnd.getTime() - options.toleranceDays * MILLISECONDS_PER_DAY,
  );
  const closesLastCompleteMonth = last.getTime() >= monthEndThreshold.getTime();

  if (ageDays > options.toleranceDays && !closesLastCompleteMonth) {
    return {
      ...base,
      verdict: 'STALE',
      disposition: options.enforce ? 'REJECT' : 'ACCEPT',
      reasons: [
        `antiguedad:${String(ageDays)}d`,
        `tolerancia:${String(options.toleranceDays)}d`,
        `cierre-de-mes-admitido-desde:${isoDay(monthEndThreshold)}`,
        ...(options.enforce ? [] : ['compuerta-en-medicion']),
      ],
    };
  }

  return {
    ...base,
    verdict: 'CURRENT',
    disposition: 'ACCEPT',
    reasons:
      ageDays > options.toleranceDays
        ? [
            `antiguedad:${String(ageDays)}d`,
            `cierra-el-ultimo-mes-completo:${isoDay(lastMonthEnd)}`,
          ]
        : [`antiguedad:${String(ageDays)}d`],
  };
}

/**
 * La frase que lee quien subió el documento.
 *
 * Dice la acción y el periodo concreto, porque «tu extracto está vencido» deja a
 * la persona adivinando cuál sirve. El detalle en días queda en la traza.
 */
export function stalenessMessage(assessment: RecencyAssessment): string {
  if (assessment.verdict === 'FUTURE_DATED') {
    return (
      'Las fechas del extracto son posteriores a hoy y no pudimos interpretarlas con seguridad. ' +
      'Una persona lo está revisando.'
    );
  }
  return (
    'Ese extracto ya no está vigente: termina antes del último mes completo. ' +
    'Descarga de tu banca por internet los últimos 3 meses completos (por ejemplo, de julio a septiembre) o hasta hoy.'
  );
}

/** Normaliza opciones parciales contra las de por defecto. */
export function normalizeRecencyOptions(
  overrides: Partial<RecencyGateOptions> = {},
): RecencyGateOptions {
  const merged = { ...DEFAULT_RECENCY_OPTIONS, ...overrides };
  return {
    ...merged,
    toleranceDays: nonNegativeInteger(merged.toleranceDays, DEFAULT_RECENCY_OPTIONS.toleranceDays),
    futureToleranceDays: nonNegativeInteger(
      merged.futureToleranceDays,
      DEFAULT_RECENCY_OPTIONS.futureToleranceDays,
    ),
  };
}

function nonNegativeInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

/**
 * El día UTC de una fecha, sin su hora.
 *
 * En UTC y no en la zona del servidor porque las fechas del extracto se parsean
 * en UTC: comparar un mediodía local contra una medianoche UTC desplaza la
 * antigüedad un día entero según dónde corra el proceso, y una tolerancia de
 * tres días no sobrevive a un error de uno.
 */
function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const LA_PAZ_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/La_Paz',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * El último día del mes natural ANTERIOR al de hoy en Bolivia, a medianoche UTC
 * (la misma escala que las fechas del extracto). Ver «Dos maneras de estar vigente».
 */
export function lastCompleteMonthEnd(now: Date): Date {
  const [year, month] = LA_PAZ_DAY.format(now).split('-').map(Number) as [number, number, number];
  // Día 0 del mes en curso = último día del mes anterior (Date.UTC usa meses desde 0).
  return new Date(Date.UTC(year, month - 1, 0));
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
