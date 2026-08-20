import { RESILIENCE_ERROR_CODES, TtsProviderError } from '../../domain/errors';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  openMs: number;
  /** Solo los fallos transitorios abren el circuito: un 400 es un error de configuración. */
  countsAsFailure?: (error: unknown) => boolean;
  onStateChange?: (state: CircuitState) => void;
  now?: () => number;
}

/**
 * Breaker de tres estados. Tras `openMs` deja pasar **una** petición de prueba
 * en lugar de reabrir de golpe, lo que evitaría una estampida contra un
 * proveedor que aún no se ha recuperado.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private probing = false;
  private state: CircuitState = 'CLOSED';

  constructor(private readonly options: CircuitBreakerOptions) {}

  get currentState(): CircuitState {
    return this.state;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.refreshState();
    if (this.state === 'OPEN' || (this.state === 'HALF_OPEN' && this.probing)) {
      throw new TtsProviderError(
        'Circuito del proveedor abierto',
        RESILIENCE_ERROR_CODES.circuitOpen,
        true,
        Math.max(0, this.options.openMs - (this.now() - this.openedAt)),
      );
    }
    const isProbe = this.state === 'HALF_OPEN';
    if (isProbe) this.probing = true;
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error, isProbe);
      throw error;
    } finally {
      if (isProbe) this.probing = false;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.openedAt = 0;
    this.transition('CLOSED');
  }

  private onFailure(error: unknown, wasProbe: boolean): void {
    const counts = this.options.countsAsFailure?.(error) ?? true;
    if (!counts) return;
    if (wasProbe) {
      // La prueba falló: se reabre la ventana completa.
      this.openedAt = this.now();
      this.transition('OPEN');
      return;
    }
    this.failures += 1;
    if (this.failures >= this.options.failureThreshold) {
      this.openedAt = this.now();
      this.transition('OPEN');
    }
  }

  private refreshState(): void {
    if (this.state === 'OPEN' && this.now() - this.openedAt >= this.options.openMs) {
      this.transition('HALF_OPEN');
    }
  }

  private transition(next: CircuitState): void {
    if (this.state === next) return;
    this.state = next;
    this.options.onStateChange?.(next);
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
