/**
 * Redis-backed cache and fixed-window counter. Production fails closed when Redis is required;
 * the in-memory fallback exists only for local development and isolated tests.
 */
import { HttpStatus, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { DomainException } from '../errors/domain-exception';

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

interface MemoryCounter {
  count: number;
  expiresAt: number;
}

export interface FixedWindowResult {
  count: number;
  ttlSeconds: number;
}

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis?: Redis;
  private readonly memory = new Map<string, MemoryEntry>();
  private readonly counters = new Map<string, MemoryCounter>();
  private readonly strictRedis: boolean;
  private readonly prefix: string;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');
    this.prefix = config.get<string>('REDIS_PREFIX') ?? 'atlas:decision';
    this.strictRedis =
      config.get<string>('NODE_ENV') === 'production' &&
      (config.get<boolean>('REQUIRE_REDIS_IN_PRODUCTION') ?? true);
    if (url) {
      this.redis = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 1_500,
        commandTimeout: 2_000,
        connectionName: 'atlas-decision-engine',
      });
      this.redis.on('error', (error) => this.logger.warn(`Redis unavailable: ${error.message}`));
    }
  }

  async get(key: string): Promise<string | null> {
    const namespaced = this.namespaced(key);
    if (this.redis) {
      try {
        await this.ensureConnected();
        return await this.redis.get(namespaced);
      } catch (error) {
        this.handleRedisFailure(error);
      }
    }
    this.assertMemoryFallbackAllowed();
    const item = this.memory.get(namespaced);
    if (!item || item.expiresAt < Date.now()) {
      this.memory.delete(namespaced);
      return null;
    }
    return item.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    const namespaced = this.namespaced(key);
    if (this.redis) {
      try {
        await this.ensureConnected();
        await this.redis.set(namespaced, value, 'EX', ttlSeconds);
        return;
      } catch (error) {
        this.handleRedisFailure(error);
      }
    }
    this.assertMemoryFallbackAllowed();
    this.memory.set(namespaced, { value, expiresAt: Date.now() + ttlSeconds * 1_000 });
  }

  async del(key: string): Promise<void> {
    const namespaced = this.namespaced(key);
    if (this.redis) {
      try {
        await this.ensureConnected();
        await this.redis.del(namespaced);
        return;
      } catch (error) {
        this.handleRedisFailure(error);
      }
    }
    this.assertMemoryFallbackAllowed();
    this.memory.delete(namespaced);
    this.counters.delete(namespaced);
  }

  async consumeFixedWindow(key: string, windowSeconds: number): Promise<FixedWindowResult> {
    const namespaced = this.namespaced(key);
    if (this.redis) {
      try {
        await this.ensureConnected();
        const result = await this.redis.eval(
          `local count = redis.call('INCR', KEYS[1])
           if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
           local ttl = redis.call('TTL', KEYS[1])
           return {count, ttl}`,
          1,
          namespaced,
          windowSeconds,
        );
        const [count, ttl] = result as [number, number];
        return { count: Number(count), ttlSeconds: Math.max(0, Number(ttl)) };
      } catch (error) {
        this.handleRedisFailure(error);
      }
    }
    this.assertMemoryFallbackAllowed();
    const now = Date.now();
    const existing = this.counters.get(namespaced);
    if (!existing || existing.expiresAt <= now) {
      this.counters.set(namespaced, { count: 1, expiresAt: now + windowSeconds * 1_000 });
      return { count: 1, ttlSeconds: windowSeconds };
    }
    existing.count += 1;
    return {
      count: existing.count,
      ttlSeconds: Math.max(0, Math.ceil((existing.expiresAt - now) / 1_000)),
    };
  }

  // Tenant-scoped access (plan §2.9 / D-8). Prefixing every key with the tenant makes a
  // cross-tenant cache hit structurally impossible for callers that go through these
  // helpers, instead of relying on each call site to remember to embed the tenant.
  getForTenant(tenantId: bigint, key: string): Promise<string | null> {
    return this.get(this.tenantKey(tenantId, key));
  }

  setForTenant(tenantId: bigint, key: string, value: string, ttlSeconds: number): Promise<void> {
    return this.set(this.tenantKey(tenantId, key), value, ttlSeconds);
  }

  delForTenant(tenantId: bigint, key: string): Promise<void> {
    return this.del(this.tenantKey(tenantId, key));
  }

  private tenantKey(tenantId: bigint, key: string): string {
    return `t:${tenantId.toString()}:${key}`;
  }

  async ping(): Promise<'redis' | 'memory'> {
    if (this.redis) {
      try {
        await this.ensureConnected();
        const response = await this.redis.ping();
        // `String(...)`: el tipo declara `'PONG'`, así que aquí el compilador ya cree que
        // `response` es `never`. La comprobación existe precisamente porque el tipo es una
        // promesa del driver, no una garantía del servidor que hay al otro lado.
        if (response !== 'PONG')
          throw new Error(`Unexpected Redis PING response: ${String(response)}`);
        return 'redis';
      } catch (error) {
        this.handleRedisFailure(error);
      }
    }
    this.assertMemoryFallbackAllowed();
    return 'memory';
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis?.status === 'ready') await this.redis.quit();
    else this.redis?.disconnect();
  }

  private namespaced(key: string): string {
    return `${this.prefix}:${key}`;
  }

  private async ensureConnected(): Promise<void> {
    if (!this.redis) return;
    if (this.redis.status === 'wait' || this.redis.status === 'end') await this.redis.connect();
  }

  private handleRedisFailure(error: unknown): never | void {
    if (this.strictRedis) {
      throw new DomainException(
        'REDIS_UNAVAILABLE',
        'Redis is required but unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
    this.logger.warn('Using in-memory cache fallback outside production');
  }

  private assertMemoryFallbackAllowed(): void {
    if (this.strictRedis) {
      throw new DomainException(
        'REDIS_REQUIRED',
        'In-memory cache fallback is disabled in production',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
