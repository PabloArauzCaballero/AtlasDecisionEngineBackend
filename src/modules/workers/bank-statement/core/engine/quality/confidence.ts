/**
 * Bandas de confianza publicadas. Un integrador debe poder decidir con el
 * número sin leer el código que lo produjo.
 */
export type ConfidenceBand = 'ALTA' | 'ACEPTABLE' | 'REQUIERE_REVISION' | 'NO_CONFIABLE';

export interface ConfidenceInput {
  /** Qué tan seguro es que el documento sea un estado de cuenta. */
  readonly documentConfidence: number;
  /** Qué tan seguro es a qué entidad pertenece. */
  readonly institutionConfidence: number;
  /** Qué parte de la estructura —columnas, filas— se reconoció. */
  readonly structureConfidence: number;
  /** Qué proporción de las comprobaciones contables ejecutadas pasó. */
  readonly reconciliationConfidence: number;
  /** Comprobaciones contables que se pudieron ejecutar. */
  readonly checksRun: number;
}

export interface ConfidenceBreakdown extends ConfidenceInput {
  readonly overallConfidence: number;
  readonly band: ConfidenceBand;
}

/**
 * Pesos del promedio, ordenados por lo que cada término **demuestra**:
 *
 * - La conciliación es el único término que puede fallar contra datos que el
 *   analizador no produjo —los saldos y totales que imprime el banco—, así que
 *   es el que más pesa.
 * - La estructura viene después: si las columnas no se reconocieron, ninguna
 *   otra señal salva el resultado.
 * - Saber de qué entidad es el documento no hace que sus cifras estén bien
 *   leídas, y por eso es el término que menos pesa.
 */
const WEIGHTS = {
  reconciliation: 0.4,
  structure: 0.35,
  document: 0.15,
  institution: 0.1,
} as const;

/**
 * Techo cuando no se pudo ejecutar **ninguna** comprobación contable.
 *
 * Un extracto sin saldos ni totales publicados no es verificable: puede estar
 * perfectamente leído, pero nadie puede demostrarlo. Publicar 0.95 en ese caso
 * sería afirmar una certeza que no existe.
 */
const UNVERIFIABLE_CEILING = 0.75;

export function composeConfidence(input: ConfidenceInput): ConfidenceBreakdown {
  const weighted =
    WEIGHTS.reconciliation * input.reconciliationConfidence +
    WEIGHTS.structure * input.structureConfidence +
    WEIGHTS.document * input.documentConfidence +
    WEIGHTS.institution * input.institutionConfidence;

  const capped = input.checksRun === 0 ? Math.min(weighted, UNVERIFIABLE_CEILING) : weighted;
  const overallConfidence = Number(Math.max(0, Math.min(1, capped)).toFixed(2));

  return {
    ...input,
    overallConfidence,
    band: confidenceBand(overallConfidence),
  };
}

export function confidenceBand(value: number): ConfidenceBand {
  if (value >= 0.9) return 'ALTA';
  if (value >= 0.75) return 'ACEPTABLE';
  if (value >= 0.5) return 'REQUIERE_REVISION';
  return 'NO_CONFIABLE';
}
