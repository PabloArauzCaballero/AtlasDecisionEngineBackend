import { Injectable } from '@nestjs/common';
import { Registry } from 'prom-client';

/**
 * El registro Prometheus que comparten todos los grupos de métricas.
 *
 * Cada instancia es dueña de su `Registry` y no del global por omisión: construir un segundo
 * servicio (en pruebas, o en un segundo contexto Nest) nunca dispara la guarda «metric already
 * registered» de prom-client.
 */
@Injectable()
export class MetricsRegistry {
  readonly registry = new Registry();

  /**
   * Muestreadores ejecutados justo antes de exponer el registro.
   *
   * El tamaño de un pool es un valor que solo tiene sentido en el instante de la lectura;
   * publicarlo desde un temporizador propio añadiría un reloj más al proceso y aun así
   * daría un dato viejo. Quien conoce los pools se registra aquí y se le pregunta al
   * hacer scrape.
   */
  private readonly collectors = new Set<() => void>();

  registerCollector(collect: () => void): void {
    this.collectors.add(collect);
  }

  /** Corre los muestreadores y devuelve el texto de exposición. */
  async scrape(): Promise<string> {
    for (const collect of this.collectors) {
      // Un muestreador roto no puede impedir que se sirva el resto de las métricas: el
      // scrape es justo lo que se consulta cuando algo va mal.
      try {
        collect();
      } catch {
        /* el fallo ya se refleja en la ausencia de esa serie */
      }
    }
    return this.registry.metrics();
  }
}
