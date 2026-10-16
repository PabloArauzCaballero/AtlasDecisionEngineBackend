import { isPotentiallyCatastrophic, safeRegexTest } from '../../../common/validation/safe-regex';
import type { SeededRandom } from '../seeded-random';
import { emitSequence } from './emit';
import { parsePattern } from './parse';
import { EMISSION_BUDGET } from './types-and-constants';

/**
 * Una cadena que casa con `pattern`, o `null` si el patrón usa construcciones no
 * soportadas o si ningún intento superó `accepts` (por ejemplo, la longitud declarada).
 */
export function sampleForPattern(
  pattern: string,
  random: SeededRandom,
  accepts: (candidate: string) => boolean = () => true,
  attempts = 12,
): string | null {
  // Un patrón con retroceso catastrófico no se compila ni para comprobar: `safeRegexTest`
  // fallaría cerrado y todos los intentos se descartarían igualmente.
  if (isPotentiallyCatastrophic(pattern)) return null;
  const alternatives = parsePattern(pattern);
  if (!alternatives) return null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const budget = { left: EMISSION_BUDGET };
    const candidate = emitSequence(random.pick(alternatives), random, budget);
    if (budget.left > 0 && safeRegexTest(pattern, candidate).matched && accepts(candidate)) {
      return candidate;
    }
  }
  return null;
}
