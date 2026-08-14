/**
 * Los cortes con los que una medición se convierte en veredicto.
 *
 * Están aquí, en un solo sitio y con su justificación, por lo que pasa cuando no lo están: cada
 * pantalla elige su color, cada informe su adjetivo, y la conversación deja de ser «el PSI subió a
 * 0,27» para ser «a mí me sale amarillo y a ti rojo».
 *
 * Ninguno es una ley de la naturaleza. Son los de uso corriente en riesgo de crédito y están
 * puestos para poder discutirlos con un número delante.
 */
import { MonitoringVerdict } from '@prisma/client';

/** Códigos de métrica. Cadenas y no enum: el catálogo crece sin migración. */
export const METRIC = {
  psi: 'PSI',
  badRate: 'BAD_RATE',
  approvalRate: 'APPROVAL_RATE',
  adverseImpactRatio: 'ADVERSE_IMPACT_RATIO',
  ks: 'KS',
  auc: 'AUC',
  calibrationHl: 'CALIBRATION_HL',
  outcomeCoverage: 'OUTCOME_COVERAGE',
  /**
   * Antigüedad de la última evaluación, en horas. Es la métrica que vigila a las demás: una
   * vigilancia que se detuvo y no avisa es peor que ninguna, porque el tablero sigue en verde
   * enseñando la última foto buena.
   */
  monitoringFreshness: 'MONITORING_FRESHNESS_HOURS',
} as const;

/** Cómo se compara el valor con el umbral. */
type Direction = 'higher-is-worse' | 'lower-is-worse';

interface ThresholdSpec {
  /** Entra en `WATCH` a partir de aquí. */
  watch: number;
  /** Entra en `BREACH` a partir de aquí. */
  breach: number;
  direction: Direction;
  /** Por debajo de esta muestra no se emite veredicto: sería ruido con aspecto de alarma. */
  minimumSample: number;
  why: string;
}

export const THRESHOLDS: Readonly<Record<string, ThresholdSpec>> = {
  [METRIC.psi]: {
    watch: 0.1,
    breach: 0.25,
    direction: 'higher-is-worse',
    minimumSample: 200,
    why: 'Cortes clásicos del índice de estabilidad poblacional: < 0,10 estable, 0,10–0,25 vigilar, > 0,25 población distinta.',
  },
  [METRIC.adverseImpactRatio]: {
    // Ojo a la dirección: aquí lo MALO es un valor bajo.
    watch: 0.9,
    breach: 0.8,
    direction: 'lower-is-worse',
    minimumSample: 100,
    why: 'Regla de los cuatro quintos (Regulation B / EEOC): por debajo de 0,80 exige explicación.',
  },
  [METRIC.ks]: {
    watch: 0.3,
    breach: 0.2,
    direction: 'lower-is-worse',
    minimumSample: 100,
    why: 'En crédito, KS < 0,20 es un modelo que apenas ordena; por encima de 0,30 se considera utilizable.',
  },
  [METRIC.auc]: {
    watch: 0.65,
    breach: 0.58,
    direction: 'lower-is-worse',
    minimumSample: 100,
    why: 'AUC 0,5 es azar. Por debajo de 0,58 el modelo aporta poco sobre no tenerlo.',
  },
  [METRIC.calibrationHl]: {
    watch: 15.5,
    breach: 20.1,
    direction: 'higher-is-worse',
    minimumSample: 100,
    why: 'Hosmer-Lemeshow con 8 grados de libertad: 15,5 rechaza el buen ajuste al 95 %, 20,1 al 99 %.',
  },
  [METRIC.outcomeCoverage]: {
    watch: 0.9,
    breach: 0.75,
    direction: 'lower-is-worse',
    minimumSample: 20,
    why: 'Por debajo del 75 % de ventanas vencidas observadas, todo lo que se mida encima describe una muestra sesgada hacia lo que alguien cargó.',
  },
  [METRIC.monitoringFreshness]: {
    watch: 26,
    breach: 48,
    direction: 'higher-is-worse',
    // Esta métrica se emite SIEMPRE, incluso sin ninguna decisión: su ausencia es la noticia.
    minimumSample: 0,
    why: 'La evaluación es diaria; 26 h admite un retraso normal y 48 h significa que se saltó un día entero.',
  },
};

/**
 * Veredicto de una medición.
 *
 * Con muestra insuficiente devuelve `OK` y no `WATCH`. Es deliberado y discutible: un veredicto de
 * alarma sobre doce casos entrena a quien lo lee a ignorar el color, y a partir de entonces el
 * gate no sirve para nada. La muestra viaja en la fila (`sample_size`), así que la pantalla puede
 * enseñar «sin datos suficientes» sin que eso sea una alarma.
 */
export function verdictFor(metricCode: string, value: number, sampleSize: number): MonitoringVerdict {
  const spec = THRESHOLDS[metricCode];
  if (!spec) return MonitoringVerdict.OK;
  if (sampleSize < spec.minimumSample) return MonitoringVerdict.OK;
  if (spec.direction === 'higher-is-worse') {
    if (value >= spec.breach) return MonitoringVerdict.BREACH;
    return value >= spec.watch ? MonitoringVerdict.WATCH : MonitoringVerdict.OK;
  }
  if (value <= spec.breach) return MonitoringVerdict.BREACH;
  return value <= spec.watch ? MonitoringVerdict.WATCH : MonitoringVerdict.OK;
}

/** El umbral que se persiste junto al valor, para que la fila se pueda leer sin este archivo. */
export function thresholdOf(metricCode: string): number {
  return THRESHOLDS[metricCode]?.breach ?? 0;
}
