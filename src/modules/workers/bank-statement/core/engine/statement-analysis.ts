import type { ParsedStatement } from '../domain/models';
import type { ParserDetectionResult, StrategyKind } from './parser-strategy';
import type { ConfidenceBreakdown } from './quality/confidence';
import type { ValidationReport } from './quality/financial-validations';
import type { StatementContext } from './statement-context';

/**
 * Resultado completo de una conversión: lo que se leyó, con qué se leyó y qué
 * tan verificable es.
 *
 * Existe porque `ParsedStatement` no puede crecer: su forma es la del CSV, la
 * del JSON y la del contrato OpenAPI publicados. Todo lo que el motor sabe
 * **sobre** el análisis —estrategia elegida, comprobaciones ejecutadas,
 * confianza desglosada— vive aquí, y de aquí sale el modelo normalizado.
 */
export interface StatementAnalysis {
  readonly statement: ParsedStatement;
  readonly context: StatementContext;
  readonly strategy: {
    readonly id: string;
    readonly kind: StrategyKind;
    readonly version: string;
  };
  readonly detection: ParserDetectionResult;
  readonly quality: ConfidenceBreakdown;
  readonly validation: ValidationReport;
  readonly warnings: readonly string[];
  readonly printedTotals: {
    readonly debit?: string;
    readonly credit?: string;
  };
  readonly accountType: string;
  /** Cuentas rotuladas en el documento, cuando publica más de una. */
  readonly accounts: readonly string[];
  /** Páginas que hubo que reconocer ópticamente. */
  readonly ocrPages: readonly number[];
  /**
   * Milisegundos por etapa del proceso. Es lo que permite saber **dónde** se
   * fue el tiempo de una conversión lenta sin instrumentar el módulo desde
   * fuera.
   */
  readonly stageDurations: Readonly<Record<string, number>>;
  readonly durationMs: number;
}
