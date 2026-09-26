/**
 * Limitador de ritmo por proceso. El alcance es deliberadamente local: con N
 * réplicas el ritmo agregado es N veces mayor, por lo que la cuota efectiva se
 * divide entre `replicaCount`. Un limitador distribuido requiere un ADR propio.
 */
export class ProviderRateGate {
  private nextAllowedAt = 0;
  private readonly intervalMs: number;

  constructor(requestsPerSecond: number, replicaCount = 1) {
    const effective = requestsPerSecond / Math.max(1, replicaCount);
    this.intervalMs = Math.ceil(1000 / Math.max(effective, 0.001));
  }

  async waitTurn(): Promise<void> {
    const now = Date.now();
    const waitMs = Math.max(0, this.nextAllowedAt - now);
    this.nextAllowedAt = Math.max(now, this.nextAllowedAt) + this.intervalMs;
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

/** Backoff exponencial con jitter completo: evita que las réplicas reintenten a la vez. */
export function backoffWithJitter(attempt: number, baseMs: number, capMs = 5000): number {
  const ceiling = Math.min(baseMs * 2 ** attempt, capMs);
  return Math.floor(Math.random() * ceiling);
}
