import { ConfigService } from '@nestjs/config';
import { HashService } from '../src/common/crypto/hash.service';

/**
 * Plan §3.9: a compiled-artifact / node-config checksum must be stable regardless of the
 * order object keys happen to be written in, otherwise a deployment checksum comparison
 * (used for rollback safety and drift detection) could spuriously fail. canonicalize sorts
 * keys, so these lock that guarantee in.
 */
describe('Checksum stability', () => {
  const hashes = new HashService(new ConfigService({ AUDIT_HASH_SECRET: 'test-secret-with-at-least-32-characters!' }));

  it('produces the same sha256 for the same config written with keys in different order', () => {
    const a = { threshold: 600, band: 'A', weights: { income: 0.5, score: 0.5 } };
    const b = { weights: { score: 0.5, income: 0.5 }, band: 'A', threshold: 600 };
    expect(hashes.sha256(a)).toBe(hashes.sha256(b));
  });

  it('produces the same sha256 for nested arrays and objects regardless of key order', () => {
    const a = { nodes: [{ id: 1, op: 'gte' }, { id: 2, op: 'lt' }], meta: { v: 1, tag: 'x' } };
    const b = { meta: { tag: 'x', v: 1 }, nodes: [{ op: 'gte', id: 1 }, { op: 'lt', id: 2 }] };
    expect(hashes.sha256(a)).toBe(hashes.sha256(b));
  });

  it('changes the checksum when a value actually changes', () => {
    const base = { threshold: 600 };
    expect(hashes.sha256(base)).not.toBe(hashes.sha256({ threshold: 601 }));
  });

  it('distinguishes array order, which is significant', () => {
    // Unlike object keys, array element order is meaningful and must change the checksum.
    expect(hashes.sha256({ steps: [1, 2, 3] })).not.toBe(hashes.sha256({ steps: [3, 2, 1] }));
  });
});
