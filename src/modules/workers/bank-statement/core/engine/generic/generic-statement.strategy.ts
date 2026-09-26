import { Injectable } from '@nestjs/common';
import type { BankTransaction } from '../../domain/models';
import { transactionConfidence } from '../../parsers/parser-helpers';
import type {
  ParserDetectionResult,
  StatementParseOutcome,
  StatementParserStrategy,
} from '../parser-strategy';
import type { StatementContext } from '../statement-context';
import { extractGenericMetadata } from './metadata-extractor';
import type { BuiltMovement } from './movement-builder';
import { TableAnalyzer, type TableAnalysis } from './table-analyzer';
import { adviseColumns, type StatementColumnAdvisorPort } from './column-advisor';

/**
 * Techo de confianza del motor generalista.
 *
 * Nunca puede igualar a un analizador especializado, por bien que le haya ido
 * con un documento concreto: su plantilla no está medida contra un extracto
 * real, y la diferencia entre «reconocí la estructura» y «conozco este formato»
 * tiene que seguir siendo visible en el número.
 */
export const GENERIC_MAX_CONFIDENCE = 0.85;

/** Penalización de confianza de la fila según de dónde salió su signo. */
const SIGN_PENALTY: Readonly<Record<string, number>> = {
  SIN_DETERMINAR: 0.35,
  GLOSA: 0.15,
};

/**
 * Analizador de último recurso: lee un extracto de una entidad que nadie
 * configuró, deduciendo su estructura del propio documento.
 *
 * Solo actúa cuando ninguna estrategia más específica acepta el documento, y
 * únicamente si la clasificación demostró que se trata de un estado de cuenta.
 * Todo lo que no puede leer lo deja vacío y lo advierte: la alternativa
 * —rellenar huecos con supuestos— produciría un extracto plausible y falso, que
 * es el peor resultado posible en este dominio.
 */
@Injectable()
export class GenericStatementStrategy implements StatementParserStrategy {
  readonly id = 'generic:table-inference-v1';
  readonly kind = 'GENERIC' as const;
  readonly version = '1';

  private readonly analyzer = new TableAnalyzer();

  /**
   * El consejero de columnas es OPCIONAL y viene ausente.
   *
   * Sin él, la estrategia es exactamente la que era. Con él, y sólo cuando el
   * saldo NO cuadra y hay rótulos que el diccionario no supo nombrar, se pide
   * una asignación y se acepta únicamente si el saldo pasa a cuadrar entero.
   */
  constructor(private readonly columnAdvisor: StatementColumnAdvisorPort | null = null) {}

  canHandle(context: StatementContext): Promise<ParserDetectionResult> {
    return Promise.resolve(
      detectWithAnalyzer(this.analyzer, context, {
        ceiling: GENERIC_MAX_CONFIDENCE,
        gateOnClassification: true,
        documentEvidence: context.classification.confidence,
      }),
    );
  }

  async parse(context: StatementContext): Promise<StatementParseOutcome> {
    const baseline = this.analyzer.analyze(context.pdf);
    if (this.columnAdvisor === null) return parseWithAnalyzer(baseline, context);

    const advised = await adviseColumns(this.columnAdvisor, context.pdf, baseline);
    if (advised === null) return parseWithAnalyzer(baseline, context);

    const outcome = parseWithAnalyzer(advised.analysis, context);
    /*
     * Que hubo consejo se DICE. Un extracto leído con ayuda de un modelo y otro
     * leído sólo con el diccionario no son la misma afirmación, aunque los dos
     * cuadren: el segundo tiene detrás un catálogo que alguien escribió y el
     * primero una asignación que nadie ha revisado todavía. Además señala qué
     * rótulos merecen entrar en `header-lexicon.ts`, que es donde deberían
     * acabar para no volver a pagar la llamada.
     */
    return {
      ...outcome,
      warnings: [
        ...outcome.warnings,
        `COLUMNAS_ASIGNADAS_POR_MODELO: ${[...advised.advice]
          .map(([rotulo, campo]) => `${rotulo}→${campo}`)
          .join(', ')} (${advised.mismatchesBefore} descuadres antes, 0 después)`,
      ],
    };
  }
}

export interface DetectionOptions {
  /**
   * Techo de confianza de la estrategia.
   */
  readonly ceiling: number;
  /**
   * Si la clasificación del documento es condición para aceptarlo.
   *
   * El motor generalista **sí** la exige: es su única garantía de no convertir
   * una factura en movimientos. Un perfil configurable **no**, y la diferencia
   * es deliberada: sus señales las declaró una persona que reconoció ese
   * formato, y esa evidencia es más fuerte que la heurística. Sin esta
   * distinción, un extracto de una cooperativa cuya carátula no usa ninguna
   * palabra reconocible quedaría fuera incluso teniendo un perfil escrito
   * para él.
   */
  readonly gateOnClassification: boolean;
  /** Evidencia de que el documento es un estado de cuenta, entre 0 y 1. */
  readonly documentEvidence: number;
}

/**
 * Detección común al motor generalista y a los perfiles: ambos aceptan un
 * documento cuando el analizador reconoce una tabla con movimientos. Lo que
 * cambia entre ellos es de dónde sale la evidencia y hasta dónde puede llegar
 * la confianza.
 */
export function detectWithAnalyzer(
  analyzer: TableAnalyzer,
  context: StatementContext,
  options: DetectionOptions,
): ParserDetectionResult {
  const { ceiling, gateOnClassification, documentEvidence } = options;
  if (gateOnClassification && !context.classification.isFinancialStatement) {
    return {
      canHandle: false,
      confidence: 0,
      reasons: [`documento-no-financiero:${context.classification.documentType}`],
    };
  }

  const analysis = analyzer.analyze(context.pdf);
  if (analysis.movements.length === 0) {
    return {
      canHandle: false,
      confidence: 0,
      reasons: ['sin-tabla-de-movimientos-reconocible'],
    };
  }

  const confidence = Number(
    Math.min(ceiling, 0.5 * analysis.structureScore + 0.5 * documentEvidence).toFixed(2),
  );
  return {
    canHandle: true,
    confidence,
    reasons: [
      `columnas:${[...analysis.fields].join(',')}`,
      `movimientos:${analysis.movements.length}`,
    ],
  };
}

export function parseWithAnalyzer(
  analysis: TableAnalysis,
  context: StatementContext,
): StatementParseOutcome {
  const transactions = analysis.movements.map((movement) => {
    const transaction: BankTransaction = { ...movement.transaction };
    transaction.extractionConfidence = rowConfidence(movement);
    if (movement.warnings.length > 0) transaction.warnings = movement.warnings;
    return transaction;
  });

  const {
    metadata,
    totals,
    accountType,
    accounts,
    warnings: metadataWarnings,
  } = extractGenericMetadata(
    context.pdf,
    context.institution,
    transactions,
    analysis.numberFormat,
    analysis.dateInterpretation,
  );

  return {
    statement: { metadata, transactions },
    structureConfidence: Number(analysis.structureScore.toFixed(2)),
    warnings: [...analysis.warnings, ...metadataWarnings],
    accountType,
    accounts,
    printedTotals: { debit: totals.debit, credit: totals.credit },
  };
}

/**
 * Baja la confianza de la fila cuando su signo no vino del banco sino de una
 * deducción. Una fila cuyo importe pudo haber ido en el otro sentido no vale lo
 * mismo que una leída de columnas separadas.
 */
function rowConfidence(movement: BuiltMovement): string {
  const base = Number(transactionConfidence(movement.transaction));
  const penalty = SIGN_PENALTY[movement.signSource] ?? 0;
  return Math.max(0, base - penalty).toFixed(2);
}
