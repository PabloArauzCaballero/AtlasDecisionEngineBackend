/**
 * Cronómetro de las etapas de una conversión. Mide todo el pipeline, no solo
 * lo asíncrono: la clasificación y la validación son las dos etapas que más
 * crecen con el tamaño del documento.
 */
export class StageTimer {
  readonly durations: Record<string, number> = {};

  async time<T>(stage: string, work: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      return await work();
    } finally {
      this.durations[stage] = Date.now() - start;
    }
  }

  /** Cronometra una etapa síncrona sin obligar a envolverla en una promesa. */
  timeSync<T>(stage: string, work: () => T): T {
    const start = Date.now();
    try {
      return work();
    } finally {
      this.durations[stage] = Date.now() - start;
    }
  }
}
