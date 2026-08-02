import { parseBigIntId, parseIfMatch } from '../src/common/http/id';

/** Regression coverage for the API boundary shared by every numeric path/body id. */
describe('parseBigIntId', () => {
  it('accepts positive PostgreSQL BIGINT identifiers', () => {
    expect(parseBigIntId('1')).toBe(1n);
    expect(parseBigIntId('9223372036854775807')).toBe(9_223_372_036_854_775_807n);
  });

  it.each(['0', '-1', '01', 'abc', '9223372036854775808'])(
    'rejects malformed or out-of-range id %s as a client error',
    (value) => {
      expect(() => parseBigIntId(value, 'artifactId')).toThrow(
        expect.objectContaining({ code: 'INVALID_ID', status: 400 }),
      );
    },
  );
});

describe('parseIfMatch', () => {
  it('accepts a PostgreSQL integer lock version and rejects unsafe values', () => {
    expect(parseIfMatch('"42"')).toBe(42);
    expect(() => parseIfMatch('2147483648')).toThrow(
      expect.objectContaining({ code: 'INVALID_IF_MATCH' }),
    );
    expect(() => parseIfMatch('9007199254740992')).toThrow(
      expect.objectContaining({ code: 'INVALID_IF_MATCH' }),
    );
  });
});
