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

  if (ageDays > options.toleranceDays) {
    return {
      ...base,
      verdict: 'STALE',
      disposition: options.enforce ? 'REJECT' : 'ACCEPT',
      reasons: [
        `antiguedad:${String(ageDays)}d`,
        `tolerancia:${String(options.toleranceDays)}d`,
        ...(options.enforce ? [] : ['compuerta-en-medicion']),
      ],
    };
  }

  return {
    ...base,
    verdict: 'CURRENT',
    disposition: 'ACCEPT',
    reasons: [`antiguedad:${String(ageDays)}d`],
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
    'Ese extracto ya no está vigente: su último movimiento es anterior a los días que admitimos. ' +
    'Entra a tu banca por internet y descarga el extracto hasta la fecha de hoy.'
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
