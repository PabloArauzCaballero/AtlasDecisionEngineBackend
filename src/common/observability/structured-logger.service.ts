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

const SENSITIVE_KEYS = new Set(
  [
    // Credentials and transport secrets.
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
    // Decision inputs carry financial PII. They travel under generic container keys
    // (`variables`, `input`, `context`, `payload`…) that an allowlist keyed only on
    // credential names would miss, so a service logging `{ variables: {...} }` would
    // otherwise write applicant PII in clear. Over-redaction is the safe failure mode
    // here; anything decision-shaped is redacted wholesale rather than risk a leak.
    'variables',
    'input',
    'inputs',
    'inputPayload',
    'inputJson',
    'context',
    'payload',
    'payloadJson',
    'decisionInput',
    'subjectData',
    'attributes',
    'facts',
    'pii',
    // Common raw PII field names, in case one is logged directly rather than nested.
    'ssn',
    'nationalId',
    'taxId',
    'dateOfBirth',
    'dob',
    'pan',
    'cardNumber',
    'email',
    'phone',
  ].map((key) => key.toLowerCase()),
);

/**
 * Nest routes every `new Logger(context)` call site through whatever instance is
 * registered via `app.useLogger()` (main.ts), so backing this service with Pino is
 * enough to make all existing loggers across the codebase emit structured Pino JSON
 * without touching each call site. Stdout is mandatory; file output is an explicit,
 * failure-tolerant opt-in for deployments with a writable mounted volume.
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
    this.pino = pino(
      {
        level: 'trace',
        base: {
          service: 'atlas-decision-engine-backend',
          version: this.config.get<string>('BUILD_VERSION') ?? 'unknown',
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      pino.multistream(this.streams()),
    );
  }

  /**
   * stdout is always written and is the only destination by default. Opening a file
   * stream unconditionally used to abort startup wherever the root filesystem is
   * read-only — which is every container this ships in — so the file sink is now an
   * explicit opt-in that expects a mounted, writable volume.
   */
  private streams(): pino.StreamEntry[] {
    const streams: pino.StreamEntry[] = [{ stream: process.stdout }];
    if ((this.config.get<string>('LOG_OUTPUT') ?? 'stdout') !== 'stdout_and_file') return streams;

    const filePath = this.config.get<string>('LOG_FILE_PATH') ?? 'logs/atlas-decision-engine.log';
    try {
      const destination = pino.destination({ dest: filePath, mkdir: true, sync: false });
      // An async destination reports an unwritable path by emitting 'error' rather than
      // throwing, and an unhandled 'error' event terminates the process. Losing the file
      // sink must never do that: stdout already carries every line.
      destination.on('error', (error: Error) => this.reportSinkFailure(filePath, error));
      streams.push({ stream: destination });
    } catch (error) {
      this.reportSinkFailure(filePath, error);
    }
    return streams;
  }

  private reportSinkFailure(filePath: string, error: unknown): void {
    process.stderr.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        context: 'StructuredLogger',
        message: `Falling back to stdout only: log file ${filePath} is not writable`,
        error: error instanceof Error ? error.message : String(error),
      })}\n`,
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
      error: error ? { name: error.name, message: error.message, stack: error.stack } : undefined,
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
      result[key] =
        SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase())
          ? '[REDACTED]'
          : this.redact(child, depth + 1);
    }
    return result;
  }
}
