import type { ParsedStatement } from '../domain/models';
import type { StatementContext } from './statement-context';

/**
 * Tipo de estrategia, de la más específica a la más general.
 *
 * No es una etiqueta descriptiva: es lo que desempata cuando dos estrategias
 * declaran la misma confianza. Sin él, el motor generalista podría desplazar a
 * un analizador verificado por un empate fortuito.
 */
export type StrategyKind = 'SPECIALIZED' | 'PROFILE' | 'GENERIC';

export const STRATEGY_PRIORITY: Readonly<Record<StrategyKind, number>> = {
  SPECIALIZED: 3,
  PROFILE: 2,
  GENERIC: 1,
};

export interface ParserDetectionResult {
  readonly canHandle: boolean;
  /** Entre 0 y 1. Es lo que ordena la cascada. */
  readonly confidence: number;
  /** Por qué se aceptó o se descartó. Queda en la traza del procesamiento. */
  readonly reasons: readonly string[];
}

export interface StatementParseOutcome {
  readonly statement: ParsedStatement;
  /**
   * Qué tan bien se reconoció la **estructura** del documento: columnas
   * identificadas, filas reconstruidas sin ambigüedad. Un analizador
   * especializado la fija en 1 porque su plantilla está medida; el generalista
   * la deriva de lo que consiguió mapear.
   */
  readonly structureConfidence: number;
  readonly warnings: readonly string[];
  /**
   * Tipo de producto rotulado por el banco («Caja de Ahorro», «CCA Altoke»).
   * No cabe en `StatementMetadata`, cuyo contrato es público y estable, pero sí
   * en el modelo normalizado.
   */
  readonly accountType?: string;
  /**
   * Totales que imprime el propio banco. Se transportan aparte de los
   * movimientos porque son la evidencia **independiente** contra la que se
   * comprueban.
   */
  readonly printedTotals?: {
    readonly debit?: string;
    readonly credit?: string;
  };
  /** Cuentas rotuladas en el documento, cuando publica más de una. */
  readonly accounts?: readonly string[];
}

/**
 * Contrato único de análisis. Lo implementan por igual un analizador de banco
 * escrito a mano, un perfil configurable y el motor generalista.
 *
 * `canHandle` es asíncrono porque una estrategia puede necesitar trabajo previo
 * —consultar perfiles almacenados, pedir OCR de una página de muestra— que un
 * predicado síncrono no admitiría.
 */
export interface StatementParserStrategy {
  /** Identificador estable, único en el registro. */
  readonly id: string;
  readonly kind: StrategyKind;
  /** Versión de las reglas. Cambia cuando cambia lo que la estrategia produce. */
  readonly version: string;
  canHandle(context: StatementContext): Promise<ParserDetectionResult>;
  parse(context: StatementContext): Promise<StatementParseOutcome>;
}

export interface ResolvedStrategy {
  readonly strategy: StatementParserStrategy;
  readonly detection: ParserDetectionResult;
}
