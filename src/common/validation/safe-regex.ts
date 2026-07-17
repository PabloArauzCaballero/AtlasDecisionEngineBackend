/**
 * Bounded regex matching for author-supplied patterns tested against request-supplied
 * values.
 *
 * A pattern is authored, but the value comes from the decision request, so a
 * catastrophic-backtracking pattern plus a crafted value can block the event loop. Node
 * offers no in-thread regex timeout, so this applies two layers:
 *
 *  1. Reject patterns whose structure can backtrack exponentially (a quantified group or
 *     character class that itself contains a quantifier, e.g. `(a+)+`, `(a*)*`, `([0-9]+)*`).
 *     Exponential blow-up starts at ~40 input characters, so a length cap alone cannot
 *     contain it — the pattern itself must be refused.
 *  2. Cap the tested input length for the patterns that remain, bounding polynomial cost.
 *
 * It is a mitigation, not a full guarantee: a dedicated authoring-time ReDoS linter or a
 * linear-time engine (re2) remains the complete defence. Both layers fail closed.
 */
const MAX_TESTED_VALUE_LENGTH = 4_096;

// A quantifier (*, +, {n,}) applied to a group or class whose body also contains a
// quantifier — the canonical source of exponential backtracking.
const NESTED_QUANTIFIER = /(\([^)]*[*+][^)]*\)|\[[^\]]*\][*+])[*+]|\([^)]*[*+][^)]*\)\{/;

const compiledCache = new Map<string, RegExp | null>();

export interface SafeRegexResult {
  /** Whether the pattern matched the value. Unsafe inputs always return false. */
  matched: boolean;
  /** Set when the value could not be safely tested. */
  error?: 'VALUE_TOO_LONG' | 'INVALID_PATTERN' | 'UNSAFE_PATTERN';
}

/** True when a pattern is structurally prone to catastrophic backtracking. */
export function isPotentiallyCatastrophic(pattern: string): boolean {
  return NESTED_QUANTIFIER.test(pattern);
}

/** Tests a bounded value against a pattern and fails closed for unsafe or invalid input. */
export function safeRegexTest(pattern: string, value: string): SafeRegexResult {
  const compiled = compile(pattern);
  if (compiled === null) {
    return { matched: false, error: isPotentiallyCatastrophic(pattern) ? 'UNSAFE_PATTERN' : 'INVALID_PATTERN' };
  }
  if (value.length > MAX_TESTED_VALUE_LENGTH) {
    // Fail closed: refuse to run an unbounded regex over an oversized value.
    return { matched: false, error: 'VALUE_TOO_LONG' };
  }
  compiled.lastIndex = 0;
  return { matched: compiled.test(value) };
}

function compile(pattern: string): RegExp | null {
  if (compiledCache.has(pattern)) return compiledCache.get(pattern) ?? null;
  let regex: RegExp | null = null;
  if (!isPotentiallyCatastrophic(pattern)) {
    try {
      regex = new RegExp(pattern);
    } catch {
      regex = null;
    }
  }
  compiledCache.set(pattern, regex);
  return regex;
}
