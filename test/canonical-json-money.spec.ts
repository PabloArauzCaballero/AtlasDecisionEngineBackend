import { canonicalize } from '../src/common/crypto/canonical-json';
import { Money } from '../src/common/money/money';

describe('canonicalize with Money', () => {
  it('serializes Money as an exact decimal string, not a float', () => {
    const out = canonicalize({ amount: Money.fromDecimalString('2000.50') });
    expect(out).toBe('{"amount":"2000.50"}');
  });

  it('serializes a sum that a float would corrupt', () => {
    const amount = Money.fromDecimalString('0.10').add(Money.fromDecimalString('0.20'));
    expect(canonicalize({ amount })).toBe('{"amount":"0.30"}');
  });

  // The blast radius guard: audit and idempotency hashes are built from canonicalize(), so
  // plain numbers must serialize exactly as before or every historical hash would break.
  it('leaves plain numbers, strings and nesting byte-for-byte unchanged', () => {
    const payload = { b: 2, a: 'x', n: 3.5, arr: [1, 2, 3], obj: { z: true, y: null } };
    expect(canonicalize(payload)).toBe('{"a":"x","arr":[1,2,3],"b":2,"n":3.5,"obj":{"y":null,"z":true}}');
  });

  it('still sorts keys deterministically when Money is present', () => {
    const out = canonicalize({ z: Money.fromDecimalString('1.00'), a: Money.fromDecimalString('2.00') });
    expect(out).toBe('{"a":"2.00","z":"1.00"}');
  });
});
