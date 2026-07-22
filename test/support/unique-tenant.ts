/**
 * A tenant id that never repeats, across runs or across concurrent processes.
 *
 * `decision_audit_event` is append-only by design — the RLS migration revokes DELETE from
 * `atlas_app` and triggers block UPDATE/DELETE/TRUNCATE — so no suite can clean up the events
 * it writes. That makes a *reused* tenant id corrupting: `verifyAuditChain(tenantId)` walks the
 * tenant's entire chain, so the next run re-verifies its predecessor's leftovers and any
 * assertion on an exact event count sees both runs at once.
 *
 * The previous `base + process.pid % 10000` scheme looked unique but silently collides whenever
 * a pid repeats modulo 10000. That is exactly how these suites began failing intermittently once
 * a database was finally available to run them: tenant 844156 had accumulated two runs' worth of
 * events (10 instead of 5), and tenant 854156 eight.
 *
 * The millisecond clock is monotonic across runs and the pid separates concurrent processes;
 * `namespace` keeps two suites that start in the same millisecond apart. The result stays far
 * inside Postgres' BIGINT range.
 */
export function uniqueTenantId(namespace: number): bigint {
  return BigInt(namespace) * 10n ** 16n + BigInt(Date.now()) * 1000n + BigInt(process.pid % 1000);
}
