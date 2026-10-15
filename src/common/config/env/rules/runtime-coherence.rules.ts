import type { EnvRule } from './env-rule';

export const keepIdempotencyLeaseAboveLongestDecision: EnvRule = (value, ctx) => {
  // El lease de idempotencia tiene que sobrevivir a la decisión más larga que la
  // configuración permite. Si vence antes, otra petición reclama legítimamente la clave
  // mientras el titular sigue trabajando: la respuesta del titular ya no se cachea (la
  // guardia de propiedad de `IdempotencyService` la descarta) y el reintento vuelve a
  // ejecutar la decisión. Cada cota se comprobaba por separado y nadie comparaba las tres,
  // así que `NESTED_TREE_MAX_TOTAL_MS=120000` con el lease por defecto de 60 s era una
  // combinación aceptada que rompía la idempotencia en silencio.
  const leaseMs = value.IDEMPOTENCY_LEASE_SECONDS * 1_000;
  const longestDecisionMs = Math.max(value.REQUEST_TIMEOUT_MS, value.NESTED_TREE_MAX_TOTAL_MS);
  if (leaseMs <= longestDecisionMs) {
    ctx.addIssue({
      code: 'custom',
      path: ['IDEMPOTENCY_LEASE_SECONDS'],
      message:
        `El lease (${leaseMs} ms) debe superar la decisión más larga admisible ` +
        `(${longestDecisionMs} ms = máx. de REQUEST_TIMEOUT_MS y NESTED_TREE_MAX_TOTAL_MS); ` +
        'si no, una petición puede reclamar una clave que su titular sigue ejecutando',
    });
  }
};
