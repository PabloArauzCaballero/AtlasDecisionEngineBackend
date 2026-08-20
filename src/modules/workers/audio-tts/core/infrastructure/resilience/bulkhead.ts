import { RESILIENCE_ERROR_CODES, TtsProviderError } from '../../domain/errors';

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Límite de concurrencia con espera acotada. Rechazar de inmediato convertiría
 * un pico normal de tráfico en fallos artificiales que consumen reintentos
 * durables y empujan assets sanos hacia la dead-letter queue.
 */
export class Bulkhead {
  private running = 0;
  private readonly queue: Waiter[] = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueue = 0,
    private readonly maxWaitMs = 0,
  ) {}

  get inFlight(): number {
    return this.running;
  }

  get waiting(): number {
    return this.queue.length;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running += 1;
      return;
    }
    if (this.queue.length >= this.maxQueue) {
      throw new TtsProviderError(
        'Límite de concurrencia del proveedor alcanzado',
        RESILIENCE_ERROR_CODES.bulkheadFull,
        true,
      );
    }
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          reject(
            new TtsProviderError(
              'Espera agotada en la cola del proveedor',
              RESILIENCE_ERROR_CODES.bulkheadTimeout,
              true,
            ),
          );
        }, this.maxWaitMs),
      };
      this.queue.push(waiter);
    });
    this.running += 1;
  }

  private release(): void {
    this.running -= 1;
    const next = this.queue.shift();
    if (!next) return;
    clearTimeout(next.timer);
    next.resolve();
  }
}
