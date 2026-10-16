import type { ExtractedPdf, PageLine } from '../../../domain/models';
import { assignToColumns, columnText, detectTables, type TableRegion } from '../column-detector';
import {
  detectDateInterpretation,
  looksLikeDate,
  DEFAULT_DATE_INTERPRETATION,
  type DateInterpretation,
} from '../date-reader';
import type { CanonicalField } from '../header-lexicon';
import { buildMovement, correctSignsWithBalance, type BuiltMovement } from '../movement-builder';
import { detectNumberFormat } from '../number-format';
import { assembleRows } from '../row-assembler';
import { accountsByLine, countOrphans, lastAccountBefore, pageFurniture } from './helpers';
import { STRUCTURE_WEIGHTS, TableAnalysis, TableAnalyzerOptions } from './settings';

/**
 * Reconstruye los movimientos de un PDF a partir de sus tablas.
 *
 * Es el núcleo compartido: el motor generalista lo usa sin ajustes y un perfil
 * configurable lo usa con los suyos. Que sea el mismo código en los dos casos
 * es lo que hace que un perfil sea **datos** y no una implementación paralela
 * que puede divergir.
 */
export class TableAnalyzer {
  /**
   * El análisis es caro y varias llamadas —detección y análisis— necesitan el
   * mismo resultado. La caché es por documento extraído y por instancia, de
   * modo que dos perfiles con ajustes distintos no comparten resultado.
   */
  private readonly cache = new WeakMap<ExtractedPdf, TableAnalysis>();

  constructor(private readonly options: TableAnalyzerOptions = {}) {}

  analyze(pdf: ExtractedPdf): TableAnalysis {
    const cached = this.cache.get(pdf);
    if (cached) return cached;

    const regions = detectTables(pdf, this.options.extraAliases)
      .filter((region) => region.layout.fields.has('transactionDate'))
      .map((region) => this.withoutIgnoredLines(region));

    const fields = new Set<CanonicalField>();
    for (const region of regions) {
      for (const field of region.layout.fields) fields.add(field);
    }

    const numberFormat =
      this.options.numberFormat ??
      detectNumberFormat(this.samples(regions, ['amount', 'debit', 'credit', 'balance']));
    const dateInterpretation = this.dateRules(regions);

    const movements: BuiltMovement[] = [];
    const warnings: string[] = [];
    let orphanLines = 0;

    // Un documento puede traer varias cuentas, cada una con su tabla. Se anota
    // a qué cuenta pertenece cada movimiento en lugar de mezclarlos: son saldos
    // distintos, y sumarlos produciría un extracto que no existe.
    const accountByLine = accountsByLine(pdf);
    const multiAccount = new Set(accountByLine.filter(Boolean)).size > 1;
    const isFurniture = pageFurniture(pdf);

    for (const region of regions) {
      const columns = region.layout.columns;
      const regionAccount = lastAccountBefore(accountByLine, region.startIndex);
      const assembly = assembleRows(region.lines, (line) =>
        looksLikeDate(
          columnText(assignToColumns(line, columns), columns, 'transactionDate'),
          dateInterpretation,
        ),
      );
      orphanLines += countOrphans(region, assembly.rows, isFurniture);
      for (const row of assembly.rows) {
        const movement = buildMovement(row, {
          columns,
          numberFormat,
          dateInterpretation,
        });
        if (!movement) continue;
        movements.push(
          multiAccount && regionAccount
            ? {
                ...movement,
                transaction: {
                  ...movement.transaction,
                  account: regionAccount,
                },
              }
            : movement,
        );
      }
    }

    if (multiAccount) {
      warnings.push(
        `movimientos-etiquetados-por-cuenta:${new Set(accountByLine.filter(Boolean)).size}`,
      );
    }

    const corrected = correctSignsWithBalance(movements);
    if (corrected > 0) warnings.push(`signos-corregidos-por-saldo:${corrected}`);
    if (orphanLines > 0) warnings.push(`renglones-no-atribuidos:${orphanLines}`);
    if (regions.length === 0) warnings.push('sin-cabecera-de-tabla-reconocible');

    const analysis: TableAnalysis = {
      movements,
      fields,
      structureScore: this.structureScore(fields, movements, orphanLines),
      warnings,
      numberFormat,
      dateInterpretation,
    };
    this.cache.set(pdf, analysis);
    return analysis;
  }

  private withoutIgnoredLines(region: TableRegion): TableRegion {
    const patterns = this.options.ignoredPatterns;
    if (!patterns || patterns.length === 0) return region;
    return {
      ...region,
      lines: region.lines.filter(
        (line: PageLine) => !patterns.some((pattern) => pattern.test(line.text)),
      ),
    };
  }

  private dateRules(regions: readonly TableRegion[]): DateInterpretation {
    const samples = [...this.samples(regions, ['transactionDate'])];
    const defaultYear = samples
      .map((sample) => /(?<!\d)(\d{4})(?!\d)/.exec(sample)?.[1])
      .find(Boolean);
    if (this.options.dayFirst !== undefined) {
      return {
        ...DEFAULT_DATE_INTERPRETATION,
        dayFirst: this.options.dayFirst,
        defaultYear,
      };
    }
    return detectDateInterpretation(samples, defaultYear);
  }

  /**
   * Qué parte de la estructura se reconoció. Suma lo identificado y resta lo que
   * quedó suelto, para que un documento medio leído no puntúe como uno leído
   * entero.
   */
  private structureScore(
    fields: ReadonlySet<CanonicalField>,
    movements: readonly BuiltMovement[],
    orphanLines: number,
  ): number {
    if (movements.length === 0) return 0;
    let score = 0;
    for (const [field, weight] of Object.entries(STRUCTURE_WEIGHTS)) {
      if (fields.has(field as CanonicalField)) score += weight ?? 0;
    }

    const weakSigns = movements.filter(
      (movement) => movement.signSource === 'SIN_DETERMINAR' || movement.signSource === 'GLOSA',
    ).length;
    const weakRatio = weakSigns / movements.length;
    const orphanRatio = orphanLines / (orphanLines + movements.length);

    return Math.max(0, Math.min(1, score - 0.3 * weakRatio - 0.2 * orphanRatio));
  }

  private *samples(
    regions: readonly TableRegion[],
    wanted: readonly CanonicalField[],
  ): Generator<string> {
    for (const region of regions) {
      const columns = region.layout.columns;
      for (const line of region.lines) {
        const assigned = assignToColumns(line, columns);
        for (const field of wanted) {
          const value = columnText(assigned, columns, field);
          if (value) yield value;
        }
      }
    }
  }
}
