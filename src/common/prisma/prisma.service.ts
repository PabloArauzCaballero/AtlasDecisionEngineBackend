import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { RequestContextService } from '../context/request-context.service';

/**
 * Prisma client that sets the Postgres `app.tenant_id` GUC for every request-scoped query,
 * so the tenant Row-Level Security policies (migration 20260719080000) actually enforce
 * isolation as defense in depth (plan §2.6).
 *
 * How the context reaches the database:
 *  - Plain model operations are wrapped by a query extension that batches
 *    `set_config('app.tenant_id', <tenant>, true)` with the operation in ONE transaction,
 *    so the transaction-local GUC applies to that statement.
 *  - `$transaction` (both callback and array forms) is overridden to set the GUC as the
 *    first statement, so every query inside a transaction is covered too.
 *  - When there is no tenant in the request context (auth resolution, health, migrations,
 *    seeds) the GUC is left unset; the policies allow an unset context, so those paths are
 *    unaffected. This is why RLS is inert until the app connects as the non-superuser
 *    atlas_app role — a superuser bypasses RLS regardless.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  private readonly nodeEnv: string;

  constructor(
    config: ConfigService,
    private readonly requestContext: RequestContextService,
  ) {
    const statementTimeout = Math.trunc(
      config.get<number>('DATABASE_STATEMENT_TIMEOUT_MS') ?? 30_000,
    );
    const pool = new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      max: config.get<number>('DATABASE_POOL_MAX') ?? 15,
      connectionTimeoutMillis: config.get<number>('DATABASE_CONNECTION_TIMEOUT_MS') ?? 5_000,
      idleTimeoutMillis: config.get<number>('DATABASE_IDLE_TIMEOUT_MS') ?? 30_000,
      application_name: 'atlas-decision-engine',
      options: `-c statement_timeout=${statementTimeout} -c idle_in_transaction_session_timeout=${statementTimeout}`,
    });
    pool.on('error', (error) => {
      process.stderr.write(
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'error',
          context: 'PostgresPool',
          message: error.message,
        })}\n`,
      );
    });
    super({ adapter: new PrismaPg(pool, { disposeExternalPool: false }) });
    this.pool = pool;
    this.nodeEnv = config.get<string>('NODE_ENV') ?? 'development';
    return this.withTenantRls();
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.assertNotSuperuser();
    this.logger.log('PostgreSQL connection established');
  }

  /**
   * RLS is inert for a superuser connection (see the class doc comment), so a superuser
   * DATABASE_URL reaching the API in production would silently disable every tenant-isolation
   * policy. Fails closed in production; only warns elsewhere so local/dev flows that
   * legitimately use the admin role (before `bootstrap-app-role` is wired up) still work.
   */
  private async assertNotSuperuser(): Promise<void> {
    const [{ isSuperuser }] = await this.$queryRaw<{ isSuperuser: boolean }[]>`
      SELECT current_setting('is_superuser')::boolean AS "isSuperuser"
    `;
    if (!isSuperuser) return;
    const message =
      'Database connection is a superuser role — tenant Row-Level Security policies are ' +
      'inert for this connection. The API must connect as the non-superuser atlas_app role ' +
      '(see scripts/set-app-db-role.mjs and docs/DEPLOYMENT.md).';
    if (this.nodeEnv === 'production') {
      throw new Error(message);
    }
    this.logger.warn(message);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    await this.pool.end();
  }

  private currentTenantId(): string | undefined {
    return this.requestContext.get()?.tenantId;
  }

  /**
   * Returns a Proxy that routes model operations through a tenant-setting query extension
   * and `$transaction` through a tenant-setting override, while every other member (raw
   * queries, $connect, lifecycle) falls through to the base client unchanged.
   */
  private withTenantRls(): this {
    const base = this;
    // Captured before proxying so the overrides can reach the un-proxied originals without
    // re-entering the Proxy (which would recurse).
    const rawTransaction = PrismaClient.prototype.$transaction.bind(this) as unknown as (
      ...args: unknown[]
    ) => Promise<unknown>;

    const extended = this.$extends({
      query: {
        $allModels: {
          async $allOperations({ args, query }) {
            const tenantId = base.currentTenantId();
            if (tenantId === undefined) return query(args);
            const [, result] = (await rawTransaction([
              base.setTenantStatement(tenantId),
              query(args),
            ])) as [unknown, unknown];
            return result;
          },
        },
      },
    });

    const tenantTransaction = (arg: unknown, options?: unknown): Promise<unknown> => {
      const tenantId = base.currentTenantId();
      if (tenantId === undefined) return rawTransaction(arg, options);
      if (Array.isArray(arg)) {
        // Prepend the tenant statement, then drop its result so callers still get their
        // operations' results in the order they passed them.
        return rawTransaction([base.setTenantStatement(tenantId), ...arg], options).then(
          (results) => (results as unknown[]).slice(1),
        );
      }
      // Interactive form: set the GUC as the first statement inside the transaction so every
      // query the callback runs on `tx` is tenant-scoped.
      const callback = arg as (tx: unknown) => unknown;
      return rawTransaction(
        async (tx: {
          $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
        }) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
          return callback(tx);
        },
        options,
      );
    };

    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop === '$transaction') return tenantTransaction;
        if (
          typeof prop === 'string' &&
          !prop.startsWith('$') &&
          !prop.startsWith('_') &&
          prop in extended
        ) {
          const value = (extended as unknown as Record<string, unknown>)[prop];
          if (value && typeof value === 'object') return value;
        }
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as this;
  }

  /** A PrismaPromise that sets the tenant GUC transaction-locally, for batching. */
  private setTenantStatement(tenantId: string) {
    return this.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
  }
}
