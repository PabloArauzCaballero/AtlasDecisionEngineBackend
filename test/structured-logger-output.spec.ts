import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StructuredLoggerService } from '../src/common/observability/structured-logger.service';
import { RequestContextService } from '../src/common/context/request-context.service';

/**
 * Container regression: the logger used to open a file sink unconditionally, which
 * aborts startup on the read-only root filesystem every container image uses.
 */
describe('StructuredLoggerService log output', () => {
  const logDir = join(tmpdir(), `atlas-log-test-${process.pid}`);
  const logFile = join(logDir, 'atlas.log');

  afterEach(async () => {
    // The file sink is async, so let it settle before removing the directory underneath it.
    await new Promise((resolve) => setTimeout(resolve, 150));
    rmSync(logDir, { recursive: true, force: true });
  });

  function logger(env: Record<string, unknown>): StructuredLoggerService {
    return new StructuredLoggerService(new ConfigService(env), new RequestContextService());
  }

  it('does not touch the filesystem by default', () => {
    const instance = logger({ LOG_FILE_PATH: logFile });
    instance.log('hello');

    expect(existsSync(logDir)).toBe(false);
  });

  it('writes a file only when stdout_and_file is requested', async () => {
    const instance = logger({ LOG_OUTPUT: 'stdout_and_file', LOG_FILE_PATH: logFile });
    instance.log('hello');
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(existsSync(logFile)).toBe(true);
  });

  it('survives an unwritable log path instead of crashing the process', async () => {
    // Opening a directory as a log file fails the same way a read-only mount does:
    // asynchronously, via an 'error' event that would terminate the process unhandled.
    mkdirSync(logDir, { recursive: true });
    const stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);

    try {
      const instance = logger({ LOG_OUTPUT: 'stdout_and_file', LOG_FILE_PATH: logDir });
      expect(() => instance.log('hello')).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 250));

      const reported = stderr.mock.calls.some((call) =>
        String(call[0]).includes('Falling back to stdout only'),
      );
      expect(reported).toBe(true);
    } finally {
      stderr.mockRestore();
    }
  });
});
