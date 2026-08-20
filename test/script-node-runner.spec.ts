import { ConfigService } from '@nestjs/config';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ScriptNodeRunnerService } from '../src/modules/graph/script-node-runner.service';

/**
 * Presupuesto de tiempo para los casos que SÍ ejecutan un script.
 *
 * No es un ajuste de tolerancia: estas pruebas asertan comportamiento —qué devuelve el motor,
 * qué error produce—, nunca latencia. El presupuesto sólo tiene que quedar por encima del coste
 * de arrancar el proceso hijo, que no depende de este código.
 *
 * Estaba en 3 s asumiendo un arranque de 300-500 ms. Medido en una máquina de desarrollo
 * Windows con contenedores en marcha, `node -e 0` tarda entre 1 356 y 2 919 ms: el peor caso ya
 * consumía el presupuesto entero antes de ejecutar una sola línea del script, y la prueba
 * fallaba con `script timed out` sin que hubiera nada roto. Un presupuesto generoso no ralentiza
 * nada —es un techo, no una espera— y elimina un fallo intermitente que dependía de la carga.
 *
 * El caso que verifica el timeout usa su propio valor corto, deliberadamente.
 */
const SPAWN_BUDGET_MS = 15_000;

describe('ScriptNodeRunnerService (IN_PROCESS)', () => {
  it('is fail-closed by default', async () => {
    const runner = new ScriptNodeRunnerService(new ConfigService({ SCRIPT_NODES_ENABLED: false }));
    await expect(runner.execute('JAVASCRIPT', 'return { scoring: 700 };', {})).rejects.toThrow(
      'disabled',
    );
  });

  it('runs JavaScript out of process and returns a JSON object', async () => {
    const runner = new ScriptNodeRunnerService(
      new ConfigService({
        SCRIPT_NODES_ENABLED: true,
        SCRIPT_NODE_TIMEOUT_MS: SPAWN_BUDGET_MS,
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
        // Con 3 s, un arranque lento mataba el proceso ANTES de que la guardia de
        // determinismo pudiera rechazarlo, y la prueba veía `timed out` en lugar del
        // `exited with status` que es lo que de verdad comprueba.
        SCRIPT_NODE_TIMEOUT_MS: SPAWN_BUDGET_MS,
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
