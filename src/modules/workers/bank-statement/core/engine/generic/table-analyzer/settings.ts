import { type DateInterpretation } from '../date-reader';
import type { CanonicalField, ExtraAliases } from '../header-lexicon';
import { type BuiltMovement } from '../movement-builder';
import { type NumberFormat } from '../number-format';

/**
 * Páginas en las que un renglón tiene que repetirse, en el mismo sitio, para
 * considerarlo encabezado o pie de página y no un renglón suelto.
 *
 * Tres es el mínimo con el que «repetirse» significa algo: dos coincidencias
 * pueden ser dos movimientos con la misma glosa cayendo a la misma altura.
 */
export const FURNITURE_MIN_PAGES = 3;

/** Tolerancia vertical al comparar dos renglones de páginas distintas, en puntos. */
export const FURNITURE_Y_TOLERANCE = 2;

/** Aportes al reconocimiento de la estructura, por campo canónico presente. */
export const STRUCTURE_WEIGHTS: Readonly<Partial<Record<CanonicalField, number>>> = {
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
