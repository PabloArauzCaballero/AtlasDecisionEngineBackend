import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    const pool = new Pool({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      max: config.get<number>('DATABASE_POOL_MAX') ?? 15,
      connectionTimeoutMillis: config.get<number>('DATABASE_CONNECTION_TIMEOUT_MS') ?? 5_000,
      idleTimeoutMillis: config.get<number>('DATABASE_IDLE_TIMEOUT_MS') ?? 30_000,
      application_name: 'atlas-decision-engine',
    });
    const statementTimeout = config.get<number>('DATABASE_STATEMENT_TIMEOUT_MS') ?? 30_000;
    pool.on('connect', (client) => {
      void client.query(`SET statement_timeout TO ${Math.trunc(statementTimeout)}`);
      void client.query(`SET idle_in_transaction_session_timeout TO ${Math.trunc(statementTimeout)}`);
    });
    pool.on('error', (error) => {
      process.stderr.write(`${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        context: 'PostgresPool',
        message: error.message,
      })}\n`);
    });
    super({ adapter: new PrismaPg(pool, { disposeExternalPool: false }) });
    this.pool = pool;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('PostgreSQL connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    await this.pool.end();
  }
}
