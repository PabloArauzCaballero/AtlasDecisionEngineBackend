/**
 * Redis como conexión registrada.
 *
 * No se añade ningún cliente nuevo: envuelve el `CacheService` que ya gobierna la caché y
 * los contadores de rate limit. Existe para que el poliglotismo sea real y no una promesa
 * del diagrama — el registro contiene dos motores, `/health/data-sources` los muestra por
 * separado y una regla de routing puede mandar un módulo a `redis` sin código nuevo.
 *
 * Su rol es `read-write` porque la caché acepta ambas, pero sus capacidades (declaradas en
 * `adapter-capabilities`) no incluyen transacciones: un módulo que las exija no puede
 * enrutarse aquí, y el arranque lo dice.
 */
import type { CacheService } from '../../cache/cache.service';
import type {
  ConnectionHealth,
  ConnectionPoolStats,
  DataConnection,
} from '../ports/data-source.types';

export const CACHE_CONNECTION = 'redis-cache';

export class CacheConnection implements DataConnection {
  readonly name = CACHE_CONNECTION;
  readonly engine = 'redis' as const;
  readonly role = 'read-write' as const;
  readonly provider = 'generic' as const;
  /** Sin URL: el `CacheService` es el dueño del cliente y de su configuración. */
  readonly fingerprint = 'redis|managed-by-cache-service';

  constructor(private readonly cache: CacheService) {}

  /** El `CacheService` conecta de forma perezosa y degrada solo; no hay nada que forzar aquí. */
  async connect(): Promise<void> {}

  async healthCheck(): Promise<ConnectionHealth> {
    const startedAt = Date.now();
    try {
      // `ping()` devuelve el modo activo: `memory` no es un fallo sino la degradación
      // declarada para desarrollo. Donde Redis es obligatorio (producción) lanza, y ese
      // es el único caso que se reporta como caído.
      const mode = await this.cache.ping();
      return {
        name: this.name,
        engine: this.engine,
        role: this.role,
        status: 'up',
        latencyMs: Date.now() - startedAt,
        detail: mode,
      };
    } catch {
      return {
        name: this.name,
        engine: this.engine,
        role: this.role,
        status: 'down',
        latencyMs: Date.now() - startedAt,
        detail: 'unavailable',
      };
    }
  }

  poolStats(): ConnectionPoolStats | undefined {
    return undefined;
  }

  /** El ciclo de vida del cliente Redis lo cierra `CacheService.onModuleDestroy`. */
  async close(): Promise<void> {}
}
