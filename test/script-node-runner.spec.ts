import { ConfigService } from '@nestjs/config';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';

describe('ScriptNodeRunnerService (IN_PROCESS)', () => {
  it('is fail-closed by default', async () => {
    const runner = new ScriptNodeRunnerService(new ConfigService({ SCRIPT_NODES_ENABLED: false }));
    await expect(runner.execute('JAVASCRIPT', 'return { scoring: 700 };', {})).rejects.toThrow(
      'disabled',
    );
  });

  // Spawning the child node.exe alone costs 300-500ms on Windows dev machines, so these
  // tests budget well above it; what they assert is behaviour, not latency.
  it('runs JavaScript out of process and returns a JSON object', async () => {
    const runner = new ScriptNodeRunnerService(
      new ConfigService({
        SCRIPT_NODES_ENABLED: true,
        SCRIPT_NODE_TIMEOUT_MS: 3000,
      }),
    );
    await expect(
      runner.execute('JAVASCRIPT', 'return { scoring: variables.base + 20 };', {
        variables: { base: 680 },
        decision: {},
        output: {},
      }),
    ).resolves.toEqual({ scoring: 700 });
  });

  it('rejects non-deterministic JavaScript', async () => {
    const runner = new ScriptNodeRunnerService(
      new ConfigService({
        SCRIPT_NODES_ENABLED: true,
        SCRIPT_NODE_TIMEOUT_MS: 3000,
      }),
    );
    await expect(
      runner.execute('JAVASCRIPT', 'return { scoring: Math.random() };', {
        variables: {},
        decision: {},
        output: {},
      }),
    ).rejects.toThrow('exited with status');
  });
});

describe('ScriptNodeRunnerService (SIDECAR)', () => {
  let socketPath: string;
  let server: http.Server;

  beforeEach(() => {
    socketPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-runner-test-')),
      'runner.sock',
    );
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(path.dirname(socketPath), { recursive: true, force: true });
  });

  function startFakeSidecar(handler: (body: unknown) => { status: number; body: unknown }) {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const { status, body } = handler(JSON.parse(raw));
        const json = JSON.stringify(body);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(json);
      });
    });
    return new Promise<void>((resolve) => server.listen(socketPath, resolve));
  }

  // Binding a Unix domain socket to an arbitrary filesystem path is a Linux/macOS feature;
  // it is not reliably supported by Node on Windows dev machines. The production target
  // (docker-compose.yml's script-runner sidecar) is Linux-only, so these are skipped on
  // win32 rather than faked, to avoid masking a real regression with a platform workaround.
  const itUnix = process.platform === 'win32' ? it.skip : it;

  itUnix('delegates execution to the sidecar over the Unix socket', async () => {
    await startFakeSidecar((body) => {
      expect(body).toMatchObject({ language: 'JAVASCRIPT', source: 'return { scoring: 700 };' });
      return { status: 200, body: { ok: true, result: { scoring: 700 } } };
    });
    const runner = new ScriptNodeRunnerService(
      new ConfigService({
        SCRIPT_NODES_ENABLED: true,
        SCRIPT_RUNNER_MODE: 'SIDECAR',
        SCRIPT_RUNNER_SOCKET_PATH: socketPath,
      }),
    );
    await expect(runner.execute('JAVASCRIPT', 'return { scoring: 700 };', {})).resolves.toEqual({
      scoring: 700,
    });
  });

  itUnix('surfaces the sidecar error code and message on failure', async () => {
    await startFakeSidecar(() => ({
      status: 422,
      body: {
        ok: false,
        code: 'SCRIPT_EXECUTION_FAILED',
        message: 'RESULT JAVASCRIPT script timed out',
      },
    }));
    const runner = new ScriptNodeRunnerService(
      new ConfigService({
        SCRIPT_NODES_ENABLED: true,
        SCRIPT_RUNNER_MODE: 'SIDECAR',
        SCRIPT_RUNNER_SOCKET_PATH: socketPath,
      }),
    );
    await expect(runner.execute('JAVASCRIPT', 'while(true){}', {})).rejects.toThrow('timed out');
  });

  it('fails with SCRIPT_RUNNER_UNAVAILABLE when the sidecar is unreachable', async () => {
    server = http.createServer(); // never listens, keeps afterEach's close() valid
    const runner = new ScriptNodeRunnerService(
      new ConfigService({
        SCRIPT_NODES_ENABLED: true,
        SCRIPT_RUNNER_MODE: 'SIDECAR',
        SCRIPT_RUNNER_SOCKET_PATH: socketPath,
      }),
    );
    await expect(runner.execute('JAVASCRIPT', 'return {};', {})).rejects.toThrow(
      'Could not reach the isolated script runner',
    );
  });
});
