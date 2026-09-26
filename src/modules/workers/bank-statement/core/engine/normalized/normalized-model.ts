import type { ExtractionMethod } from '../statement-context';
import type { ConfidenceBand } from '../quality/confidence';
import type { AffordabilityAssessment } from '../affordability/affordability-model';

/**
 * Contrato único de salida del motor, común a las tres estrategias.
 *
 * Se diferencia del `ParsedStatement` interno en dos cosas deliberadas: los
 * importes son números —porque este contrato es para consumo programático, no
 * para serializar sin pérdida— y **lo que no se pudo leer es `null`**, no
 * cadena vacía. La distinción importa: `null` significa «el documento no lo
 * publicaba o no se pudo leer», y ningún consumidor debería tener que adivinar
 * si una cadena vacía es un valor o una ausencia.
 *
 * El transporte interno sigue siendo `ParsedStatement` con importes como
 * cadena, por [ADR-0006]. La conversión a número ocurre una sola vez, aquí, en
 * el borde del sistema.
 */
export interface NormalizedBankStatement {
  readonly source: NormalizedSource;
  readonly institution: NormalizedInstitution;
  readonly account: NormalizedAccount;
  readonly period: NormalizedPeriod;
  readonly balances: NormalizedBalances;
  readonly totals: NormalizedTotals;
  readonly processing: NormalizedProcessing;
  readonly transactions: readonly NormalizedTransaction[];
  readonly quality: NormalizedQuality;
  /**
   * Qué dijo el contenedor del archivo. Va en el contrato de salida —y no sólo
   * en la traza— porque un consumidor que recibe movimientos tiene derecho a
   * saber con qué garantía llegan: los mismos números pesan distinto si el
   * documento se aceptó limpio o se aceptó con indicios.
   */
  readonly authenticity: NormalizedAuthenticity;
  /**
   * La capacidad de pago derivada del extracto.
   *
   * Está en el contrato normalizado y no en un endpoint aparte a propósito: el
   * cálculo depende de los movimientos de ESTE documento y de la ventana que
   * cubre, así que separarlos invitaría a combinar la capacidad de un extracto
   * con los movimientos de otro. Van juntos porque son la misma afirmación.
   */
  readonly affordability: AffordabilityAssessment;
  /**
   * Si el extracto describe el presente, y contra qué día se comprobó.
   *
   * Viaja en el contrato por lo mismo que la autenticidad: la capacidad de pago
   * de un extracto cerrado hace cuatro meses es aritmética correcta sobre una
   * situación que ya no existe, y un consumidor que sólo recibe el número no
   * tiene forma de saberlo. `evaluatedOn` va dentro porque sin él el veredicto no
   * es reproducible: el mismo documento caduca solo con el paso de los días.
   */
  readonly recency: NormalizedRecency;
  /**
   * Cuánto se parece a los extractos que su entidad emite de verdad.
   *
   * Se publica con el DENOMINADOR dentro —de dónde salió el patrón y sobre
   * cuántos documentos se midió— porque un porcentaje suelto se acaba citando
   * como si fuera una probabilidad. «91 % contra un patrón declarado a mano» y
   * «91 % contra uno medido sobre doscientos extractos» no autorizan lo mismo.
   */
  readonly similarity: NormalizedSimilarity;
}

/** El parecido con el patrón de la entidad, proyectado al contrato de salida. */
export interface NormalizedSimilarity {
  readonly verdict: 'MATCH' | 'PARTIAL' | 'MISMATCH' | 'NO_DESCRIPTOR';
  /** 0..100. */
  readonly score: number;
  readonly descriptorProvenance: string | null;
  readonly sampleSize: number | null;
  /** Si este parecido puede sostener un documento que otra señal dejó en duda. */
  readonly corroborates: boolean;
  /** Identificadores de las señales que coincidieron. */
  readonly matched: readonly string[];
  /** Identificadores de las que se esperaban y no estaban. */
  readonly missing: readonly string[];
}

/** El veredicto de la vigencia, proyectado al contrato de salida. */
export interface NormalizedRecency {
  readonly verdict: 'CURRENT' | 'STALE' | 'FUTURE_DATED' | 'UNDATED';
  /** Último día cubierto por la ventana observada. */
  readonly periodTo: string | null;
  /** Días entre ese día y aquel contra el que se evaluó. Negativo si es futuro. */
  readonly ageDays: number | null;
  /** El día contra el que se midió, para que el veredicto sea reproducible. */
  readonly evaluatedOn: string;
}

/** El veredicto del contenedor, proyectado al contrato de salida. */
export interface NormalizedAuthenticity {
  readonly verdict: 'AUTHENTIC' | 'SUSPECT' | 'TAMPERED';
  /** 0..100. */
  readonly suspicionScore: number;
  readonly producer: string | null;
  readonly creator: string | null;
  readonly incrementalUpdates: number;
  /** Códigos de las señales encontradas. El detalle queda en la traza. */
  readonly signals: readonly string[];
}

export interface NormalizedSource {
  readonly fileName: string | null;
  readonly fileHash: string;
  readonly pageCount: number;
  readonly extractionMethod: ExtractionMethod;
}

export interface NormalizedInstitution {
  readonly id: string | null;
  readonly name: string | null;
  readonly normalizedName: string | null;
  readonly country: string | null;
  readonly detected: boolean;
  readonly confidence: number;
}

export interface NormalizedAccount {
  readonly holderName: string | null;
  /** Solo los últimos dígitos quedan visibles. Nunca el número completo. */
  readonly accountNumberMasked: string | null;
  readonly accountType: string | null;
  readonly currency: string | null;
  /**
   * Todas las cuentas del documento, enmascaradas, cuando publica más de una.
   * Cada movimiento indica la suya en `accountMasked`.
   */
  readonly allAccountsMasked: readonly string[];
}

export interface NormalizedPeriod {
  readonly from: string | null;
  readonly to: string | null;
}

export interface NormalizedBalances {
  readonly opening: number | null;
  readonly closing: number | null;
}

/**
 * Totales del periodo, por las DOS vías, y esa separación es el contrato.
 *
 * `debit`/`credit` son los que **imprime el banco**: evidencia independiente
 * contra la que se concilia lo extraído, y `null` cuando el documento no los
 * publica. Sólo el generalista los venía leyendo; ninguna de las estrategias
 * especializadas los publica, así que contra extractos reales llegaban `null`
 * SIEMPRE.
 *
 * `debitExtracted`/`creditExtracted` son la suma de los movimientos leídos.
 * Existen porque quien pregunta «cuánto entró en el periodo» —un algoritmo que
 * deriva capacidad de pago— no puede depender de que el banco haya decidido
 * imprimir un total: el dato ya está, movimiento a movimiento. Sin ellos, un
 * extracto con 112 abonos bien leídos se leía como ingreso cero y la decisión
 * salía «cobertura insuficiente» —una afirmación sobre el solicitante— cuando
 * lo cierto era «el documento no imprime totales» —una sobre el papel—.
 *
 * No se funden en un solo campo a propósito: cuando los dos existen y
 * discrepan, esa discrepancia es justo lo que la conciliación tiene que ver.
 */
export interface NormalizedTotals {
  readonly debit: number | null;
  readonly credit: number | null;
  /** Suma de los cargos leídos. Siempre presente; 0 si no hubo movimientos. */
  readonly debitExtracted: number;
  /** Suma de los abonos leídos. Siempre presente; 0 si no hubo movimientos. */
  readonly creditExtracted: number;
}

/** Trazabilidad del análisis: con qué se leyó y por qué se eligió. */
export interface NormalizedProcessing {
  readonly documentType: string;
  readonly strategyId: string;
  readonly strategyKind: string;
  readonly strategyVersion: string;
  readonly detectionReasons: readonly string[];
  readonly durationMs: number;
}

export type MovementType = 'DEBIT' | 'CREDIT' | 'UNKNOWN';

export interface NormalizedTransaction {
  /** Identificador estable generado por el motor. Ver `newTransactionId`. */
  readonly id: string;
  readonly index: number;
  readonly transactionDate: string | null;
  readonly valueDate: string | null;
  readonly description: string;
  readonly reference: string | null;
  readonly documentNumber: string | null;
  readonly debit: number | null;
  readonly credit: number | null;
  readonly amount: number;
  readonly balance: number | null;
  readonly currency: string | null;
  readonly movementType: MovementType;
  readonly channel: string | null;
  readonly branch: string | null;
  /**
   * Texto del renglón tal como se leyó. Lo publica el motor generalista, donde
   * sirve para auditar una lectura inferida; los analizadores especializados,
   * cuya plantilla está medida, lo dejan en `null`.
   */
  readonly rawText: string | null;
  readonly sourcePage: number;
  readonly confidence: number;
  readonly warnings: readonly string[];
  /**
   * Cuenta a la que pertenece, en documentos con varias. `null` cuando el
   * documento publica una sola: repetirla en cada fila sería ruido.
   */
  readonly accountMasked: string | null;
}

export interface NormalizedQuality {
  readonly documentConfidence: number;
  readonly institutionConfidence: number;
  readonly structureConfidence: number;
  readonly reconciliationConfidence: number;
  readonly overallConfidence: number;
  readonly band: ConfidenceBand;
  readonly checksRun: number;
  readonly checksPassed: number;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}
