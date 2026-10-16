import { GLOSARIO_OFICIAL, type GlosaOficial } from '../../../corpus/corpus-extractos.generated';
import { Candidate, PLACEHOLDERS } from './types';

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

export function withoutPunctuation(value: string): string {
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
export const INDEX: readonly { readonly entry: GlosaOficial; readonly candidates: Candidate[] }[] =
  GLOSARIO_OFICIAL.map((entry) => ({ entry, candidates: buildCandidates(entry) }));

const ISSUERS_WITH_GLOSSARY: ReadonlySet<string> = new Set(
  GLOSARIO_OFICIAL.map((entry) => entry.emisor),
);

/** `true` si de este emisor existe glosario oficial transcrito. */
export function hasOfficialGlossary(issuer: string | null | undefined): boolean {
  return typeof issuer === 'string' && ISSUERS_WITH_GLOSSARY.has(issuer.toUpperCase());
}
