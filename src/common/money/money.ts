/**
 * Exact monetary value backed by integer minor units (plan §2.1, finding D-1).
 *
 * Money must never be a binary float: `0.1 + 0.2 !== 0.3`, and a credit/limit decision
 * that turns on a cent cannot tolerate that. A Money holds an integer count of minor units
 * (cents at scale 2) plus its scale, so every add/subtract/compare is exact.
 *
 * This is the representation layer only. Wiring it into the live expression evaluator
 * changes how monetary comparisons resolve at the edges, which can move a decision, so that
 * step is gated on Risk revalidating the thresholds against the exact type and is left
 * intentionally undone here:
 *   BLOCKED_BY_BUSINESS_DECISION — evaluator wiring + threshold revalidation on exact money.
 */
export class Money {
  private constructor(
    /** Signed integer count of minor units, e.g. 200050 for 2000.50 at scale 2. */
    readonly minorUnits: bigint,
    /** Number of fractional digits the minor units represent. */
    readonly scale: number,
    /** Optional ISO currency label. Operations require both operands to share it. */
    readonly currency?: string,
  ) {}

  static fromMinorUnits(minorUnits: bigint, scale = 2, currency?: string): Money {
    Money.assertScale(scale);
    return new Money(minorUnits, scale, currency);
  }

  /**
   * Parses an exact decimal string ("2000.50", "-3", "0.1"). Strings are the safe entry
   * point: they carry no binary-float error. A value with more fractional digits than the
   * scale is rejected rather than silently rounded — losing precision on money is a defect,
   * not a convenience.
   */
  static fromDecimalString(value: string, scale = 2, currency?: string): Money {
    Money.assertScale(scale);
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
    if (!match) throw new RangeError(`Not a decimal money value: "${value}"`);
    const [, sign, whole, fraction = ''] = match;
    if (fraction.length > scale) {
      throw new RangeError(`"${value}" has more than ${scale} fractional digits`);
    }
    const padded = fraction.padEnd(scale, '0');
    const magnitude = BigInt(`${whole}${padded}`);
    return new Money(sign === '-' ? -magnitude : magnitude, scale, currency);
  }

  /**
   * Converts a JS number to Money by rounding to the scale. Only for values that were never
   * meant to be exact in the first place (a config default); prefer fromDecimalString for
   * anything that must round-trip. Rejects non-finite input and values outside the safe
   * integer range, where the float itself is already lossy.
   */
  static fromNumber(value: number, scale = 2, currency?: string): Money {
    Money.assertScale(scale);
    if (!Number.isFinite(value))
      throw new RangeError('Cannot build Money from a non-finite number');
    const scaled = value * 10 ** scale;
    if (!Number.isSafeInteger(Math.round(scaled)) || Math.abs(scaled) > Number.MAX_SAFE_INTEGER) {
      throw new RangeError(`Number ${value} is outside the exact money range at scale ${scale}`);
    }
    return new Money(BigInt(Math.round(scaled)), scale, currency);
  }

  add(other: Money): Money {
    this.assertCompatible(other);
    return new Money(this.minorUnits + other.minorUnits, this.scale, this.currency);
  }

  subtract(other: Money): Money {
    this.assertCompatible(other);
    return new Money(this.minorUnits - other.minorUnits, this.scale, this.currency);
  }

  /** Multiplies by an integer factor only. Multiplying money by money is not a money value. */
  multiplyByInteger(factor: bigint): Money {
    return new Money(this.minorUnits * factor, this.scale, this.currency);
  }

  /** -1, 0 or 1. Comparing different scales or currencies is a programming error, not 0. */
  compareTo(other: Money): number {
    this.assertCompatible(other);
    if (this.minorUnits < other.minorUnits) return -1;
    if (this.minorUnits > other.minorUnits) return 1;
    return 0;
  }

  equals(other: Money): boolean {
    return (
      this.scale === other.scale &&
      this.currency === other.currency &&
      this.minorUnits === other.minorUnits
    );
  }

  isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  isZero(): boolean {
    return this.minorUnits === 0n;
  }

  /** Exact decimal string, e.g. "2000.50". This is the canonical representation for hashing. */
  toDecimalString(): string {
    const negative = this.minorUnits < 0n;
    const digits = (negative ? -this.minorUnits : this.minorUnits)
      .toString()
      .padStart(this.scale + 1, '0');
    const whole = digits.slice(0, digits.length - this.scale);
    const fraction = this.scale > 0 ? `.${digits.slice(digits.length - this.scale)}` : '';
    return `${negative ? '-' : ''}${whole}${fraction}`;
  }

  toString(): string {
    return this.currency ? `${this.toDecimalString()} ${this.currency}` : this.toDecimalString();
  }

  private assertCompatible(other: Money): void {
    if (this.scale !== other.scale) {
      throw new RangeError(`Cannot combine money of scale ${this.scale} with scale ${other.scale}`);
    }
    if (this.currency !== other.currency) {
      throw new RangeError(
        `Cannot combine ${this.currency ?? 'unlabelled'} with ${other.currency ?? 'unlabelled'} money`,
      );
    }
  }

  private static assertScale(scale: number): void {
    if (!Number.isInteger(scale) || scale < 0 || scale > 8) {
      throw new RangeError(`Money scale must be an integer in 0..8, got ${scale}`);
    }
  }
}
