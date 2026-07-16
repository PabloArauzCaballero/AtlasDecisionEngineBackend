import { Injectable, LoggerService, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pino, { type Logger as PinoLogger } from 'pino';
import { RequestContextService } from '../context/request-context.service';

const LEVEL_WEIGHT: Record<string, number> = {
  error: 0,
  warn: 1,
  log: 2,
  debug: 3,
  verbose: 4,
};

const PINO_METHOD: Record<string, 'error' | 'warn' | 'info' | 'debug' | 'trace'> = {
  error: 'error',
  warn: 'warn',
  log: 'info',
  debug: 'debug',
  verbose: 'trace',
};

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'apiKey',
  'password',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'subjectReference',
  'valueJson',
]);

/**
 * Nest routes every `new Logger(context)` call site through whatever instance is
 * registered via `app.useLogger()` (main.ts), so backing this service with Pino is
 * enough to make all existing loggers across the codebase emit structured Pino JSON
 * — both to stdout and to a persistent .log file — without touching each call site.
 */
@Injectable()
export class StructuredLoggerService implements LoggerService, OnModuleDestroy {
  private readonly configuredLevel: string;
  private readonly pino: PinoLogger;

  constructor(
    private readonly config: ConfigService,
    private readonly context: RequestContextService,
  ) {
    this.configuredLevel = this.config.get<string>('LOG_LEVEL') ?? 'log';
    const filePath = this.config.get<string>('LOG_FILE_PATH') ?? 'logs/atlas-decision-engine.log';
    this.pino = pino(
      {
        level: 'trace',
        base: {
          service: 'atlas-decision-engine-backend',
          version: this.config.get<string>('BUILD_VERSION') ?? 'unknown',
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      pino.multistream([
        { stream: process.stdout },
        { stream: pino.destination({ dest: filePath, mkdir: true, sync: false }) },
      ]),
    );
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('log', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('verbose', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams, 'fatal');
  }

  async onModuleDestroy(): Promise<void> {
    await new Promise<void>((resolve) => this.pino.flush(() => resolve()));
  }

  private write(
    level: keyof typeof LEVEL_WEIGHT,
    message: unknown,
    optionalParams: unknown[],
    severity: keyof typeof LEVEL_WEIGHT | 'fatal' = level,
  ): void {
    if (LEVEL_WEIGHT[level] > LEVEL_WEIGHT[this.configuredLevel]) return;
    const store = this.context.get();
    const contextName = [...optionalParams].reverse().find((value) => typeof value === 'string');
    const error = optionalParams.find((value) => value instanceof Error) as Error | undefined;
    const record = {
      requestId: store?.requestId,
      tenantId: store?.tenantId,
      principalId: store?.principalId,
      audience: store?.audience,
      authMethod: store?.authMethod,
      context: typeof contextName === 'string' ? contextName : undefined,
      metadata: this.redact(message && typeof message === 'object' ? message : undefined),
      error: error
        ? { name: error.name, message: error.message, stack: error.stack }
        : undefined,
    };
    const pinoMethod = severity === 'fatal' ? 'fatal' : PINO_METHOD[level];
    this.pino[pinoMethod](record, this.toMessage(message));
  }

  private toMessage(message: unknown): string {
    if (message instanceof Error) return message.message;
    if (typeof message === 'string') return message;
    try {
      return JSON.stringify(this.redact(message));
    } catch {
      return String(message);
    }
  }

  private redact(value: unknown, depth = 0): unknown {
    if (depth > 5) return '[TRUNCATED]';
    if (Array.isArray(value)) return value.slice(0, 50).map((item) => this.redact(item, depth + 1));
    if (!value || typeof value !== 'object') return value;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      result[key] = SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase())
        ? '[REDACTED]'
        : this.redact(child, depth + 1);
    }
    return result;
  }
}
