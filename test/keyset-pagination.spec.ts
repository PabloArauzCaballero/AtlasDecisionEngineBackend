import {
  KeysetPaginationQueryDto,
  decodeCursor,
  encodeCursor,
  keysetArgs,
  keysetPage,
} from '../src/common/http/pagination';
import { DomainException } from '../src/common/errors/domain-exception';

describe('keyset pagination', () => {
  const query = (over: Partial<KeysetPaginationQueryDto> = {}): KeysetPaginationQueryDto =>
    Object.assign(new KeysetPaginationQueryDto(), over);

  it('round-trips a bigint id through an opaque cursor', () => {
    for (const id of [0n, 1n, 42n, 9007199254740993n]) {
      expect(decodeCursor(encodeCursor(id))).toBe(id);
    }
    // The cursor is opaque (not the raw id) so callers cannot infer or forge sequence.
    expect(encodeCursor(42n)).not.toBe('42');
  });

  it('rejects a malformed or negative cursor with a 400', () => {
    expect(() => decodeCursor('not base64 !!')).toThrow(DomainException);
    expect(() => decodeCursor(encodeCursor(-1n))).toThrow(DomainException);
    expect(() => decodeCursor(Buffer.from('abc', 'utf8').toString('base64url'))).toThrow(
      /malformed/,
    );
  });

  it('builds a first-page query with take = pageSize + 1 and no where clause', () => {
    const args = keysetArgs(query({ pageSize: 25 }));
    expect(args).toEqual({ take: 26, pageSize: 25, orderBy: { id: 'desc' } });
    expect(args.where).toBeUndefined();
  });

  it('adds a descending id seek when a cursor is present and clamps pageSize', () => {
    const args = keysetArgs(query({ pageSize: 999, cursor: encodeCursor(500n) }), 100);
    expect(args.pageSize).toBe(100);
    expect(args.take).toBe(101);
    expect(args.where).toEqual({ id: { lt: 500n } });
  });

  it('trims the sentinel row and exposes a next cursor when more remain', () => {
    const rows = [{ id: 10n }, { id: 9n }, { id: 8n }]; // pageSize 2 fetched 3
    const page = keysetPage(rows, 2);
    expect(page.items.map((r) => r.id)).toEqual([10n, 9n]);
    expect(page.hasNextPage).toBe(true);
    expect(page.nextCursor).toBe(encodeCursor(9n));
  });

  it('reports the final page with a null cursor', () => {
    const page = keysetPage([{ id: 3n }, { id: 2n }], 2);
    expect(page.hasNextPage).toBe(false);
    expect(page.nextCursor).toBeNull();
    expect(keysetPage([], 2).nextCursor).toBeNull();
  });

  it('walks consecutive pages without overlap or gaps', () => {
    const all = Array.from({ length: 5 }, (_, i) => ({ id: BigInt(5 - i) })); // 5..1 desc
    const fetch = (where?: { id: { lt: bigint } }, take = 3) =>
      all.filter((r) => (where ? r.id < where.id.lt : true)).slice(0, take);

    const first = keysetPage(fetch(keysetArgs(query({ pageSize: 2 })).where, 3), 2);
    expect(first.items.map((r) => r.id)).toEqual([5n, 4n]);

    const second = keysetPage(
      fetch(keysetArgs(query({ pageSize: 2, cursor: first.nextCursor! })).where, 3),
      2,
    );
    expect(second.items.map((r) => r.id)).toEqual([3n, 2n]);

    const third = keysetPage(
      fetch(keysetArgs(query({ pageSize: 2, cursor: second.nextCursor! })).where, 3),
      2,
    );
    expect(third.items.map((r) => r.id)).toEqual([1n]);
    expect(third.hasNextPage).toBe(false);
  });
});
