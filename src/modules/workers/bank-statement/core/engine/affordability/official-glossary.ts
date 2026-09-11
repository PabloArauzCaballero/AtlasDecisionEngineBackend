/**
 * El glosario que publica el EMISOR, contra el léxico que escribimos nosotros.
 *
 * ## Qué cambia esto
 *
 * `movement-lexicon.ts` adivina qué es un movimiento a partir de palabras
 * («sueldo», «préstamo», «seguro»). Funciona, y tiene un techo: las glosas
 * reales de un banco boliviano no son palabras, son códigos. `CENT_PAGO_PREST`,
 * `NCRSIREJRET`, `WASIREJSUSODSCICC-`, `BL`, `CTPV`, `ODG`. Ninguna regla
 * escrita de memoria las acierta, y cada una de ellas mueve dinero de sitio en
 * el cálculo de capacidad de pago.
 *
 * El corpus trae las **147 filas del glosario oficial del BCP**, que es el único
 * emisor boliviano con glosario publicado que la investigación encontró. Esto
 * las consulta.
 *
 * ## Las cuatro reglas que gobiernan este archivo
 *
 * 1. **La columna contable manda sobre la dirección declarada.** El glosario
 *    dice que `ACH REC` puede ser cargo o abono y que los `NCR…` son cargos;
 *    cuando la fila dice otra cosa, gana la fila. Forzar el lado por la glosa es
 *    una de las reglas de importación que el corpus prohíbe expresamente, y su
 *    contradicción C10 existe justo por esto. Lo que sí se hace es DECLARAR la
 *    discrepancia, que es información para quien revisa.
 * 2. **La categoría es analítica, no del banco.** El corpus la marca `INFERIDO`
 *    en las 147: el emisor publica el literal y su significado en prosa, no una
 *    taxonomía. Por eso la consulta devuelve `categoryIsInferred: true` y por
 *    eso no se puede presentar como «el banco dice que esto es un seguro».
 * 3. **No se inventan expresiones regulares.** Las 147 traen `regex: null` y
 *    `match_requires_local_calibration: true`. Lo único que se deriva es lo que
 *    el propio literal declara: `AAAAMMDD` es una fecha, `"Empresa"` es un
 *    hueco, `+NÚMERO DE OPERACIÓN` es un sufijo. Nada más.
 * 4. **No se finge el glosario de nadie más.** El corpus encontró UN glosario
 *    oficial. Para los otros 66 emisores esto devuelve vacío y el léxico
 *    heurístico sigue siendo lo que hay. Rellenar los huecos con las glosas del
 *    BCP sería la peor clase de error: parecería cobertura.
 *
 * ## El peligro de los literales de una y dos letras
 *
 * El glosario tiene entradas como `I` (banca por internet), `M` (móvil), `AP`
 * (transferencia al exterior), `BA` (agente), `BL` (SOLI) y `CW` (Credinet).
 * Casarlas por prefijo convertiría cualquier glosa que empiece por «I » en una
 * operación de internet. Por eso un literal de menos de tres caracteres **sólo
 * casa exacto**, y eso deja fuera casos legítimos a propósito: preferimos no
 * clasificar a clasificar mal, porque lo segundo mueve dinero en silencio.
 */

import {
  GLOSARIO_OFICIAL,
  PROCEDENCIA_DEL_GLOSARIO,
  type DireccionDeclarada,
  type GlosaOficial,
  type TratamientoDeIngreso,
} from '../../corpus/corpus-extractos.generated';

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

const NO_MATCH: GlossaryLookup = {
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
const MINIMUM_PREFIX_LENGTH = 3;

/**
 * Huecos que los propios literales declaran, con lo que significan.
 *
 * Esto NO es inventar una expresión regular: es leer la que el emisor escribió
 * en prosa dentro de su propio literal. `COBRO_SPF_AAAAMM` dice que ahí va un
 * año y un mes; `D.A. "Empresa"` dice que ahí va el nombre de una empresa.
 * Derivarlo es transcribir; suponer que `RET` va seguido del número del cajero
 * sería inventar, y por eso no se hace.
 */
const PLACEHOLDERS: readonly { readonly mark: RegExp; readonly pattern: string }[] = [
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

interface Candidate {
  readonly text: string;
  readonly kind: GlossaryMatchKind;
  readonly regex: RegExp | null;
}

/**
 * Normaliza para comparar: mayúsculas, sin acentos y con un solo espacio.
 *
 * La puntuación se CONSERVA —`C/V DE ME` y `D.A.` la llevan y distinguen— y
 * para el caso contrario, el PDF que imprime `COM` donde el glosario dice
 * `COM.`, existe una segunda clave sin puntuación que sólo se usa para igualdad
 * exacta, nunca para prefijos.
 */
export function normalizeOfficialGloss(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function withoutPunctuation(value: string): string {
  return normalizeOfficialGloss(value)
    .replace(/[^A-Z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Separa las alternativas que el literal enumera y que el corpus no listó aparte. */
function literalAlternatives(entry: GlosaOficial): string[] {
  if (entry.alternativas.length > 0) return [...entry.alternativas];
  const literal = entry.literal;
  if (/\s+o\s+/i.test(literal)) return literal.split(/\s+o\s+/i);
  // Sólo con espacios alrededor: `REGUL CHEQ BCP/CAN` no son dos glosas.
  if (/\s\/\s/.test(literal)) return literal.split(/\s\/\s/);
  return [literal];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildCandidates(entry: GlosaOficial): Candidate[] {
  const explicit = new Set(entry.alternativas.map(normalizeOfficialGloss));
  const candidates: Candidate[] = [];

  for (const raw of literalAlternatives(entry)) {
    const text = normalizeOfficialGloss(raw);
    if (text.length === 0) continue;

    const marks: { at: number; length: number; pattern: string }[] = [];
    for (const placeholder of PLACEHOLDERS) {
      placeholder.mark.lastIndex = 0;
      let found: RegExpExecArray | null;
      while ((found = placeholder.mark.exec(text)) !== null) {
        marks.push({ at: found.index, length: found[0].length, pattern: placeholder.pattern });
        if (found[0].length === 0) placeholder.mark.lastIndex += 1;
      }
    }
    marks.sort((a, b) => a.at - b.at);

    let pattern = '';
    let cursor = 0;
    let hasPlaceholder = false;
    for (const mark of marks) {
      if (mark.at < cursor) continue;
      pattern += escapeRegex(text.slice(cursor, mark.at)) + mark.pattern;
      cursor = mark.at + mark.length;
      hasPlaceholder = true;
    }
    pattern += escapeRegex(text.slice(cursor));

    candidates.push({
      text,
      kind: hasPlaceholder
        ? 'LITERAL_TEMPLATE'
        : explicit.has(text)
          ? 'EXPLICIT_ALTERNATIVE'
          : 'EXACT_LITERAL',
      regex: hasPlaceholder ? new RegExp(`^${pattern}$`) : null,
    });
  }
  return candidates;
}

/** El índice se construye una vez: son 147 filas y no cambian en caliente. */
const INDEX: readonly { readonly entry: GlosaOficial; readonly candidates: Candidate[] }[] =
  GLOSARIO_OFICIAL.map((entry) => ({ entry, candidates: buildCandidates(entry) }));

const ISSUERS_WITH_GLOSSARY: ReadonlySet<string> = new Set(
  GLOSARIO_OFICIAL.map((entry) => entry.emisor),
);

/** `true` si de este emisor existe glosario oficial transcrito. */
export function hasOfficialGlossary(issuer: string | null | undefined): boolean {
  return typeof issuer === 'string' && ISSUERS_WITH_GLOSSARY.has(issuer.toUpperCase());
}

/**
 * Lo más restrictivo gana cuando una glosa casa con dos filas.
 *
 * El orden no es alfabético ni arbitrario: describe cuánto permite cada
 * tratamiento. `SALARY_CANDIDATE…` es el único que abre la puerta a contar algo
 * como ingreso —y aun así con condiciones—, así que es el que pierde siempre.
 */
const RESTRICTION: Record<TratamientoDeIngreso, number> = {
  EXCLUDE_FROM_RECURRING_INCOME: 3,
  DO_NOT_ASSUME_INCOME: 2,
  SALARY_CANDIDATE_REQUIRES_CREDIT_AND_VERIFICATION: 1,
};

/**
 * Busca la glosa en el glosario oficial del emisor.
 *
 * Devuelve TODAS las coincidencias de máxima especificidad, no la primera: la
 * ambigüedad del glosario es un hecho del glosario.
 */
export function lookupOfficialGlossary(
  issuer: string | null | undefined,
  description: string,
): GlossaryLookup {
  if (!hasOfficialGlossary(issuer)) return NO_MATCH;
  const code = (issuer as string).toUpperCase();
  const gloss = normalizeOfficialGloss(description);
  if (gloss.length === 0) return NO_MATCH;
  const bare = withoutPunctuation(gloss);

  const found: GlossaryMatch[] = [];
  for (const row of INDEX) {
    if (row.entry.emisor !== code) continue;
    for (const candidate of row.candidates) {
      if (candidate.regex) {
        if (candidate.regex.test(gloss)) {
          found.push({ entry: row.entry, kind: 'LITERAL_TEMPLATE', length: candidate.text.length });
        }
        continue;
      }
      if (gloss === candidate.text) {
        found.push({ entry: row.entry, kind: candidate.kind, length: candidate.text.length });
        continue;
      }
      if (bare.length > 0 && bare === withoutPunctuation(candidate.text)) {
        found.push({
          entry: row.entry,
          kind: 'EXACT_IGNORING_PUNCTUATION',
          length: candidate.text.length,
        });
        continue;
      }
      if (
        candidate.text.length >= MINIMUM_PREFIX_LENGTH &&
        gloss.startsWith(candidate.text) &&
        /[^A-Z0-9]/.test(gloss.charAt(candidate.text.length))
      ) {
        found.push({ entry: row.entry, kind: 'PREFIX', length: candidate.text.length });
      }
    }
  }

  if (found.length === 0) return NO_MATCH;

  // Gana el literal más largo: `ACH REC` describe mejor que `ACH`.
  const longest = Math.max(...found.map((match) => match.length));
  const best = dedupe(found.filter((match) => match.length === longest));
  const categories = [...new Set(best.map((match) => match.entry.categoria))];
  const directions = [...new Set(best.map((match) => match.entry.direccionDeclarada))];
  const treatment = best
    .map((match) => match.entry.tratamientoDeIngreso)
    .sort((a, b) => RESTRICTION[b] - RESTRICTION[a])[0];

  return {
    matches: best,
    categories,
    ambiguous: categories.length > 1,
    incomeTreatment: treatment,
    // Con dos filas que declaran lados distintos, el emisor no declara ninguno.
    declaredDirection: directions.length === 1 ? directions[0] : null,
    requiresLocalCalibration: best.some((match) => match.entry.requiereCalibracionLocal),
    categoryIsInferred: true,
  };
}

function dedupe(matches: readonly GlossaryMatch[]): GlossaryMatch[] {
  const seen = new Map<string, GlossaryMatch>();
  for (const match of matches) if (!seen.has(match.entry.id)) seen.set(match.entry.id, match);
  return [...seen.values()];
}

/** Qué dice la fila frente a lo que el emisor declaró para esa glosa. */
export type DirectionCoherence = 'COHERENT' | 'CONTRADICTS_GLOSSARY' | 'NOT_EVALUABLE';

/**
 * Compara el lado contable con la dirección declarada, **sin cambiar nada**.
 *
 * `CONTRADICTS_GLOSSARY` no es un veredicto de fraude ni un motivo de rechazo:
 * el propio corpus documenta que ciertas glosas son bidireccionales y que la
 * conciliación manda. Es una observación para quien revisa, y su valor está en
 * los casos raros —una glosa de retención judicial que llega como abono— donde
 * lo que suele haber detrás es una columna mal leída por el extractor.
 */
export function directionCoherence(
  lookup: GlossaryLookup,
  ledgerDirection: 'INFLOW' | 'OUTFLOW',
): DirectionCoherence {
  const declared = lookup.declaredDirection;
  if (declared === null || declared === 'UNSPECIFIED' || declared === 'BOTH')
    return 'NOT_EVALUABLE';
  const expected = declared === 'CREDIT' ? 'INFLOW' : 'OUTFLOW';
  return expected === ledgerDirection ? 'COHERENT' : 'CONTRADICTS_GLOSSARY';
}

export { PROCEDENCIA_DEL_GLOSARIO as OFFICIAL_GLOSSARY_PROVENANCE };
