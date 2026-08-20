import type { ExtractedPdf, PageLine } from '../../domain/models';
import { assignToColumns, columnText, detectTables, type TableRegion } from './column-detector';
import {
  detectDateInterpretation,
  looksLikeDate,
  DEFAULT_DATE_INTERPRETATION,
  type DateInterpretation,
} from './date-reader';
import type { CanonicalField, ExtraAliases } from './header-lexicon';
import { findAccountNumbers } from './metadata-extractor';
import { buildMovement, correctSignsWithBalance, type BuiltMovement } from './movement-builder';
import { detectNumberFormat, type NumberFormat } from './number-format';
import { assembleRows } from './row-assembler';

/**
 * Páginas en las que un renglón tiene que repetirse, en el mismo sitio, para
 * considerarlo encabezado o pie de página y no un renglón suelto.
 *
 * Tres es el mínimo con el que «repetirse» significa algo: dos coincidencias
 * pueden ser dos movimientos con la misma glosa cayendo a la misma altura.
 */
const FURNITURE_MIN_PAGES = 3;

/** Tolerancia vertical al comparar dos renglones de páginas distintas, en puntos. */
const FURNITURE_Y_TOLERANCE = 2;

/** Aportes al reconocimiento de la estructura, por campo canónico presente. */
const STRUCTURE_WEIGHTS: Readonly<Partial<Record<CanonicalField, number>>> = {
  transactionDate: 0.4,
  description: 0.15,
  amount: 0.2,
  debit: 0.1,
  credit: 0.1,
  balance: 0.15,
  documentNumber: 0.05,
  reference: 0.05,
};

/**
 * Ajustes que un perfil puede imponer al análisis. Todos son opcionales: sin
 * ninguno, el analizador deduce cada cosa del propio documento, que es como
 * trabaja el motor generalista.
 */
export interface TableAnalyzerOptions {
  /** Rótulos propios de un formato, además del diccionario común. */
  readonly extraAliases?: ExtraAliases;
  /** Convención numérica declarada, en lugar de deducirla. */
  readonly numberFormat?: NumberFormat;
  /** Orden de la fecha declarado, en lugar de deducirlo. */
  readonly dayFirst?: boolean;
  /** Renglones que nunca forman parte de la tabla: pies, leyendas, avisos. */
  readonly ignoredPatterns?: readonly RegExp[];
}

export interface TableAnalysis {
  readonly movements: readonly BuiltMovement[];
  readonly fields: ReadonlySet<CanonicalField>;
  readonly structureScore: number;
  readonly warnings: readonly string[];
  readonly numberFormat: NumberFormat;
  readonly dateInterpretation: DateInterpretation;
}

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

/**
 * Renglones que no acabaron dentro de ninguna fila **y que no son el
 * encabezado o el pie que la página repite**.
 *
 * La distinción es el motivo de que esta función exista. «Renglones no
 * atribuidos» se publica como advertencia y se lee como pérdida de datos, y en
 * un documento paginado la inmensa mayoría no lo era: el membrete, el número de
 * página y el aviso legal del pie caen fuera de toda fila por definición. Un
 * extracto de sesenta páginas leído al completo —1.200 filas, ni una perdida—
 * advertía de 415 renglones sueltos, de los cuales 398 eran su propio
 * mobiliario. Con la advertencia inflada así, la que sí importa —un movimiento
 * partido que no se pudo recomponer— queda enterrada.
 *
 * Se cuenta sobre los SOBRANTES y no se filtra la entrada a propósito: lo que
 * cambia es el recuento, nunca lo que compone una fila, así que esta heurística
 * no puede perder un movimiento por más que se equivoque.
 */
function countOrphans(
  region: TableRegion,
  rows: readonly { readonly lines: readonly PageLine[] }[],
  isFurniture: (line: PageLine) => boolean,
): number {
  const attached = new Set<PageLine>();
  for (const row of rows) for (const line of row.lines) attached.add(line);
  return region.lines.filter((line) => !attached.has(line) && !isFurniture(line)).length;
}

/**
 * Reconoce el mobiliario de página: lo que se repite igual, a la misma altura,
 * en varias páginas.
 *
 * Las dos condiciones se necesitan mutuamente. Sólo por texto, una glosa
 * recurrente —«COMISION MANTENIMIENTO CUENTA»— pasaría por membrete; sólo por
 * altura, cualquier renglón de una tabla regular coincidiría con el de la
 * página siguiente. Juntas describen lo que de verdad es un encabezado: el mismo
 * contenido impreso en el mismo sitio de cada hoja.
 *
 * Las cifras se enmascaran porque el mobiliario suele llevar la única parte que
 * cambia —«PAGINA 3 / 60», el saldo de la página— dentro de un texto por lo
 * demás idéntico.
 */
function pageFurniture(pdf: ExtractedPdf): (line: PageLine) => boolean {
  if (pdf.pageCount < FURNITURE_MIN_PAGES) return () => false;

  const key = (line: PageLine): string =>
    `${Math.round(line.y / FURNITURE_Y_TOLERANCE)}|${line.text.replace(/\d/g, '#')}`;

  const pagesByKey = new Map<string, Set<number>>();
  for (const line of pdf.lines) {
    const pages = pagesByKey.get(key(line)) ?? new Set<number>();
    pages.add(line.page);
    pagesByKey.set(key(line), pages);
  }

  return (line) => (pagesByKey.get(key(line))?.size ?? 0) >= FURNITURE_MIN_PAGES;
}

/**
 * Cuenta vigente en cada renglón del documento: la última rotulada por encima
 * de él. Es lo que permite atribuir cada tabla a su cuenta en un extracto que
 * publica varias.
 */
function accountsByLine(pdf: ExtractedPdf): string[] {
  let current = '';
  return pdf.lines.map((line) => {
    const found = findAccountNumbers(line.text);
    if (found[0]) current = found[0];
    return current;
  });
}

function lastAccountBefore(accountByLine: readonly string[], index: number): string {
  return accountByLine[Math.max(0, index - 1)] ?? '';
}
