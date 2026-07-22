import { Money } from '../src/common/money/money';

describe('Money exact arithmetic', () => {
  it('adds 0.1 + 0.2 to exactly 0.30, where binary float fails', () => {
    // The canonical proof: 0.1 + 0.2 === 0.30000000000000004 as a float.
    const sum = Money.fromDecimalString('0.10').add(Money.fromDecimalString('0.20'));
    expect(sum.toDecimalString()).toBe('0.30');
    expect(sum.minorUnits).toBe(30n);
  });

  it('parses whole, fractional and negative decimal strings', () => {
    expect(Money.fromDecimalString('2000.50').minorUnits).toBe(200050n);
    expect(Money.fromDecimalString('3').minorUnits).toBe(300n);
    expect(Money.fromDecimalString('-12.34').minorUnits).toBe(-1234n);
  });

  it('rejects a value with more fractional digits than the scale', () => {
    expect(() => Money.fromDecimalString('1.234')).toThrow(/fractional digits/);
  });

  it('rejects non-decimal garbage', () => {
    expect(() => Money.fromDecimalString('1,234.00')).toThrow(/decimal money/);
    expect(() => Money.fromDecimalString('abc')).toThrow(/decimal money/);
    expect(() => Money.fromDecimalString('')).toThrow();
  });

  it('subtracts exactly', () => {
    const result = Money.fromDecimalString('100.00').subtract(Money.fromDecimalString('0.03'));
    expect(result.toDecimalString()).toBe('99.97');
  });

  it('multiplies by an integer factor exactly', () => {
    const result = Money.fromDecimalString('19.99').multiplyByInteger(3n);
    expect(result.toDecimalString()).toBe('59.97');
  });

  it('compares by value, not by float proximity', () => {
    const a = Money.fromDecimalString('0.30');
    const b = Money.fromDecimalString('0.10').add(Money.fromDecimalString('0.20'));
    expect(a.compareTo(b)).toBe(0);
    expect(a.equals(b)).toBe(true);
    expect(Money.fromDecimalString('10.00').compareTo(Money.fromDecimalString('9.99'))).toBe(1);
    expect(Money.fromDecimalString('9.99').compareTo(Money.fromDecimalString('10.00'))).toBe(-1);
  });

  it('round-trips minor units through the decimal string', () => {
    for (const cents of [0n, 5n, 99n, 100n, 200050n, -1n, -1234n]) {
      const money = Money.fromMinorUnits(cents);
      expect(Money.fromDecimalString(money.toDecimalString()).minorUnits).toBe(cents);
    }
  });

  it('refuses to combine different scales or currencies', () => {
    expect(() =>
      Money.fromMinorUnits(100n, 2, 'USD').add(Money.fromMinorUnits(100n, 2, 'EUR')),
    ).toThrow(/USD|EUR/);
    expect(() => Money.fromMinorUnits(100n, 2).add(Money.fromMinorUnits(100n, 3))).toThrow(/scale/);
  });

  it('builds from a JS number by rounding to scale but rejects lossy magnitudes', () => {
    expect(Money.fromNumber(2000.5).toDecimalString()).toBe('2000.50');
    expect(() => Money.fromNumber(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => Money.fromNumber(1e18)).toThrow(/exact money range/);
  });

  it('formats zero and negative values with the correct sign', () => {
    expect(Money.fromMinorUnits(0n).toDecimalString()).toBe('0.00');
    expect(Money.fromMinorUnits(-5n).toDecimalString()).toBe('-0.05');
    expect(Money.fromMinorUnits(-5n, 2, 'USD').toString()).toBe('-0.05 USD');
  });

  it('supports scale 0 for zero-decimal currencies', () => {
    const yen = Money.fromDecimalString('1500', 0, 'JPY');
    expect(yen.toDecimalString()).toBe('1500');
    expect(yen.add(Money.fromDecimalString('500', 0, 'JPY')).toDecimalString()).toBe('2000');
  });

  it('reports sign and zero without arithmetic', () => {
    expect(Money.fromMinorUnits(-1n).isNegative()).toBe(true);
    expect(Money.fromMinorUnits(1n).isNegative()).toBe(false);
    expect(Money.fromMinorUnits(0n).isZero()).toBe(true);
    expect(Money.fromMinorUnits(1n).isZero()).toBe(false);
  });

  it('rejects a scale outside 0..8', () => {
    expect(() => Money.fromMinorUnits(1n, 9)).toThrow(/scale must be/);
    expect(() => Money.fromMinorUnits(1n, -1)).toThrow(/scale must be/);
    expect(() => Money.fromDecimalString('1', 2.5)).toThrow(/scale must be/);
    // The boundary values are valid.
    expect(Money.fromMinorUnits(1n, 0).scale).toBe(0);
    expect(Money.fromMinorUnits(1n, 8).scale).toBe(8);
  });

  it('throws when comparing incompatible money, and equals returns false instead', () => {
    const usd = Money.fromMinorUnits(100n, 2, 'USD');
    const eur = Money.fromMinorUnits(100n, 2, 'EUR');
    const scale3 = Money.fromMinorUnits(100n, 3, 'USD');
    expect(() => usd.compareTo(eur)).toThrow(/USD|EUR/);
    expect(() => usd.compareTo(scale3)).toThrow(/scale/);
    // equals is total: mismatched currency or scale is false, never a throw.
    expect(usd.equals(eur)).toBe(false);
    expect(usd.equals(scale3)).toBe(false);
    expect(usd.equals(Money.fromMinorUnits(100n, 2, 'USD'))).toBe(true);
  });

  it('names an unlabelled operand in the incompatibility error, either side', () => {
    expect(() => Money.fromMinorUnits(100n, 2, 'USD').add(Money.fromMinorUnits(100n, 2))).toThrow(
      /unlabelled/,
    );
    expect(() => Money.fromMinorUnits(100n, 2).add(Money.fromMinorUnits(100n, 2, 'USD'))).toThrow(
      /unlabelled/,
    );
  });

  it('multiplies by negative and zero integer factors, preserving currency', () => {
    const price = Money.fromDecimalString('19.99', 2, 'USD');
    expect(price.multiplyByInteger(-1n).toString()).toBe('-19.99 USD');
    expect(price.multiplyByInteger(0n).isZero()).toBe(true);
  });

  it('parses trimmed input and rejects an explicit plus sign', () => {
    expect(Money.fromDecimalString('  2000.50  ').minorUnits).toBe(200050n);
    expect(() => Money.fromDecimalString('+5')).toThrow(/decimal money/);
  });

  it('formats an unlabelled value without a trailing currency', () => {
    expect(Money.fromMinorUnits(200050n).toString()).toBe('2000.50');
  });
});
