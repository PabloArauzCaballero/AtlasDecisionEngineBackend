import {
  PROCEDENCIA_DEL_GLOSARIO,
  type TratamientoDeIngreso,
} from '../../../corpus/corpus-extractos.generated';
import {
  INDEX,
  hasOfficialGlossary,
  normalizeOfficialGloss,
  withoutPunctuation,
} from './index-build';
import { GlossaryLookup, GlossaryMatch, MINIMUM_PREFIX_LENGTH, NO_MATCH } from './types';

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
