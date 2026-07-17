import { isPotentiallyCatastrophic, safeRegexTest } from '../src/common/validation/safe-regex';

describe('safeRegexTest', () => {
  it('matches and rejects like a normal regex for bounded input', () => {
    expect(safeRegexTest('^[A-Z]{3}$', 'ABC').matched).toBe(true);
    expect(safeRegexTest('^[A-Z]{3}$', 'abc').matched).toBe(false);
  });

  it('reports an invalid pattern instead of throwing', () => {
    const result = safeRegexTest('([', 'anything');
    expect(result.matched).toBe(false);
    expect(result.error).toBe('INVALID_PATTERN');
  });

  it('refuses to test an oversized value (fail closed)', () => {
    const result = safeRegexTest('^[A-Z]+$', 'A'.repeat(50_000));
    expect(result.matched).toBe(false);
    expect(result.error).toBe('VALUE_TOO_LONG');
  });

  it('flags nested-quantifier patterns as catastrophic', () => {
    expect(isPotentiallyCatastrophic('^(a+)+$')).toBe(true);
    expect(isPotentiallyCatastrophic('^(a*)*$')).toBe(true);
    expect(isPotentiallyCatastrophic('^([0-9]+)*$')).toBe(true);
    expect(isPotentiallyCatastrophic('^[A-Z]{3}$')).toBe(false);
    expect(isPotentiallyCatastrophic('^\\d{4}-\\d{2}-\\d{2}$')).toBe(false);
  });

  it('refuses a catastrophic pattern outright instead of running it', () => {
    // This is the classic ReDoS case. It must be rejected before it can run, because a
    // length cap alone cannot contain exponential backtracking (blow-up starts ~40 chars).
    const start = Date.now();
    const result = safeRegexTest('^(a+)+$', `${'a'.repeat(40)}!`);
    expect(result.matched).toBe(false);
    expect(result.error).toBe('UNSAFE_PATTERN');
    expect(Date.now() - start).toBeLessThan(1_000);
  });
});
