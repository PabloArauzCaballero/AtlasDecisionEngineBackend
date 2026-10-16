import {
  type DireccionDeclarada,
  type GlosaOficial,
  type TratamientoDeIngreso,
} from '../../../corpus/corpus-extractos.generated';

/** Cómo casó un literal del glosario con la glosa que traía el extracto. */
export type GlossaryMatchKind =
  /** La glosa ES el literal publicado. */
  | 'EXACT_LITERAL'
  /** La glosa es una de las alternativas que el propio literal enumera. */
  | 'EXPLICIT_ALTERNATIVE'
  /** La glosa encaja en el hueco que el literal declara (`AAAAMMDD`, `"Empresa"`). */
  | 'LITERAL_TEMPLATE'
  /** La glosa empieza por el literal y sigue con el detalle de la operación. */
  | 'PREFIX'
  /** Igual salvo puntuación: `COM.` contra `COM`. */
  | 'EXACT_IGNORING_PUNCTUATION';

export interface GlossaryMatch {
  readonly entry: GlosaOficial;
  readonly kind: GlossaryMatchKind;
  /** Cuántos caracteres del literal casaron. Desempata entre `ACH` y `ACH REC`. */
  readonly length: number;
}

export interface GlossaryLookup {
  /** Vacío cuando el emisor no tiene glosario oficial o nada casó. */
  readonly matches: readonly GlossaryMatch[];
  /** Las categorías analíticas de las coincidencias más específicas. */
  readonly categories: readonly string[];
  /**
   * Más de una categoría para el mismo literal.
   *
   * No es un defecto: `CERTIFI CADO` está dos veces en el glosario oficial, una
   * como comisión y otra como certificado. El caso de regresión `GL_BCR_G034`
   * del corpus lo fija, y lo correcto es decirlo, no elegir una.
   */
  readonly ambiguous: boolean;
  /** El tratamiento MÁS RESTRICTIVO de las coincidencias. `null` si no hubo. */
  readonly incomeTreatment: TratamientoDeIngreso | null;
  /** Lo que el emisor declara sobre el lado contable. Nunca lo sustituye. */
  readonly declaredDirection: DireccionDeclarada | null;
  /** El corpus lo declara `true` en las 147: casar exige calibración local. */
  readonly requiresLocalCalibration: boolean;
  /** La categoría es una anotación analítica, no una etiqueta del emisor. */
  readonly categoryIsInferred: boolean;
}

export const NO_MATCH: GlossaryLookup = {
  matches: [],
  categories: [],
  ambiguous: false,
  incomeTreatment: null,
  declaredDirection: null,
  requiresLocalCalibration: false,
  categoryIsInferred: true,
};

/**
 * Longitud mínima de un literal para que se le permita casar por PREFIJO.
 *
 * Tres. Ver la nota de cabecera: por debajo el literal es un código de canal de
 * una o dos letras, y casar por prefijo produciría más error del que resuelve.
 */
export const MINIMUM_PREFIX_LENGTH = 3;

/**
 * Huecos que los propios literales declaran, con lo que significan.
 *
 * Esto NO es inventar una expresión regular: es leer la que el emisor escribió
 * en prosa dentro de su propio literal. `COBRO_SPF_AAAAMM` dice que ahí va un
 * año y un mes; `D.A. "Empresa"` dice que ahí va el nombre de una empresa.
 * Derivarlo es transcribir; suponer que `RET` va seguido del número del cajero
 * sería inventar, y por eso no se hace.
 */
export const PLACEHOLDERS: readonly { readonly mark: RegExp; readonly pattern: string }[] = [
  { mark: /AAAAMMDD/g, pattern: '\\d{8}' },
  { mark: /AAAAMM/g, pattern: '\\d{6}' },
  { mark: /DDMMAA/g, pattern: '\\d{6}' },
  // Un texto entrecomillado es el hueco de un nombre: puede llevar espacios.
  { mark: /"[^"]*"/g, pattern: '.+' },
  // Lo que el literal describe entre paréntesis es una instrucción, no texto.
  { mark: /\s*\((?:SEGUIDO|\+)[^)]*\)/g, pattern: '\\s*.*' },
  // `+NÚMERO DE OPERACIÓN`, `+ CÓDIGO`: un sufijo declarado.
  { mark: /\s*\+\s*(?:NUMERO DE OPERACION|CODIGO)/g, pattern: '\\s*.+' },
];

export interface Candidate {
  readonly text: string;
  readonly kind: GlossaryMatchKind;
  readonly regex: RegExp | null;
}
