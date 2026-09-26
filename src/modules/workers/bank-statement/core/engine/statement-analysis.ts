import type { ParsedStatement } from '../domain/models';
import type { AffordabilityAssessment } from './affordability/affordability-model';
import type { AuthenticityAssessment } from './authenticity/authenticity-gate';
import type { ParserDetectionResult, StrategyKind } from './parser-strategy';
import type { RecencyAssessment } from './recency/recency-gate';
import type { SimilarityAssessment } from './similarity/similarity-scorer';
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
  /**
   * Qué dijo el CONTENEDOR del archivo. Viaja aunque el veredicto sea limpio:
   * quien audita un documento aceptado necesita ver por qué se aceptó, y una
   * traza que sólo guarda los rechazos no permite responder «¿esto se comprobó?».
   */
  readonly authenticity: AuthenticityAssessment;
  /**
   * La capacidad de pago derivada del extracto.
   *
   * Se calcula DENTRO de la conversión y no después porque depende de los
   * movimientos ya normalizados y de la ventana observada, y porque la exigencia
   * de tres meses es una condición de admisión del documento — no un análisis
   * posterior que alguien pueda saltarse llamando a otro método.
   */
  readonly affordability: AffordabilityAssessment;
  /**
   * Si la ventana del extracto describe el presente.
   *
   * Viaja igual que la autenticidad y por lo mismo: un documento aceptado tiene
   * que poder decir CONTRA QUÉ DÍA se comprobó su vigencia. Sin `evaluatedOn` en
   * la traza, un extracto admitido hoy y el mismo extracto reprocesado en un mes
   * son dos afirmaciones distintas que se leen igual.
   */
  readonly recency: RecencyAssessment;
  /**
   * Cuánto se parece el documento a los extractos que su entidad emite de verdad.
   *
   * Es una MEDIDA y no un veredicto: viaja con su porcentaje, su denominador y la
   * lista de señales encontradas y ausentes. Está en el análisis porque es lo que
   * permite auditar un documento sostenido por el parecido —hay que poder ver
   * QUÉ coincidió— y porque sin publicarla no habría forma de calibrar los
   * umbrales sobre documentos ya procesados.
   */
  readonly similarity: SimilarityAssessment;
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
