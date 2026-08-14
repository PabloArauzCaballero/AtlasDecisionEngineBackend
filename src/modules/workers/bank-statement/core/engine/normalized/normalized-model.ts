import type { ExtractionMethod } from '../statement-context';
import type { ConfidenceBand } from '../quality/confidence';

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
