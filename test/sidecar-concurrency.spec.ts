import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The sidecar executed scripts with `spawnSync`, which blocks its single-threaded HTTP server
 * for the whole run: concurrency was effectively 1, so one script sitting on its timeout
 * stalled every other tenant's decision behind it. It now executes asynchronously, with
 * admission control instead of unbounded forking (the container caps pids at 64 and CPU at
 * 0.5), and refuses excess load with a retryable 503 rather than thrashing.
 *
 * This drives the real `runner/server.mjs` over a real socket — the sidecar's behaviour is
 * only meaningful as the process that actually ships.
 */
const RUNNER = join(__dirname, '..', 'runner', 'server.mjs');
// Windows has no Unix sockets for this purpose; the runner binds a named pipe path instead.
const socketDir = mkdtempSync(join(tmpdir(), 'atlas-runner-'));
const SOCKET_PATH =
  process.platform === 'win32'
    ? `\\\\.\\pipe\\atlas-runner-${process.pid}`
    : join(socketDir, 'runner.sock');

interface RunnerResponse {
  statusCode: number;
  body: { ok: boolean; code?: string; result?: Record<string, unknown> };
}

function post(payload: unknown): Promise<RunnerResponse> {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath: SOCKET_PATH,
        path: '/execute',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        timeout: 30_000,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () =>
          resolve({ statusCode: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : {} }),
        );
      },
    );
    req.on('timeout', () => req.destroy(new Error('runner request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

/** A script that busy-waits without a clock: the sandbox has no Date and no timers. */
function slowScript(iterations: number): string {
  return `let n = 0; for (let i = 0; i < ${iterations}; i += 1) { n += i % 7; } return { n };`;
}

describe('runner sidecar concurrency', () => {
  let runner: ChildProcess;

  beforeAll(async () => {
    runner = spawn(process.execPath, [RUNNER], {
      env: {
        ...process.env,
        RUNNER_SOCKET_PATH: SOCKET_PATH,
        RUNNER_MAX_CONCURRENCY: '4',
        RUNNER_MAX_QUEUE: '2',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    runner.stderr?.resume();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('runner did not start')), 20_000);
      runner.stdout?.setEncoding('utf8');
      runner.stdout?.on('data', (chunk: string) => {
        if (!chunk.includes('listening')) return;
        clearTimeout(timer);
        resolve();
      });
      runner.on('error', reject);
    });
  }, 30_000);

  afterAll(() => {
    runner?.kill('SIGKILL');
    rmSync(socketDir, { recursive: true, force: true });
  });

  const payload = (source: string) => ({
    language: 'JAVASCRIPT',
    source,
    context: { variables: {}, decision: {}, output: {} },
    timeoutMs: 5_000,
  });

  it('ejecuta un script y devuelve su resultado', async () => {
    const response = await post(payload('return { value: 21 * 2 };'));
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ ok: true, result: { value: 42 } });
  });

  /**
   * Con spawnSync, N peticiones concurrentes tardaban N veces lo que una.
   *
   * Cómo se mide, que aquí es lo delicado. Dos intentos anteriores no servían:
   *
   * - `cuatro < una * 2.5` discriminaba (medido: 4.01x en serie frente a 1.46x concurrente),
   *   pero compara contra una medición **aparte**, así que la carga de la máquina entra en el
   *   resultado: bajo la suite completa falló por ~5 % de margen sin ninguna regresión.
   * - `max(inicios) < min(finales)` es estable pero **no distingue nada**: las cuatro
   *   llamadas se emiten síncronamente desde el `Array.from`, así que todos los inicios son
   *   el mismo instante y la comparación solo afirma que se enviaron antes de recibir la
   *   primera respuesta — cierto por construcción. Comprobado contra el runner real con
   *   `RUNNER_MAX_CONCURRENCY=1`: la aserción PASA igual, es decir, no habría detectado la
   *   vuelta a `spawnSync`.
   *
   * Lo que sigue compara dos magnitudes de la MISMA corrida, así que la velocidad del equipo
   * se cancela: si las cuatro corren a la vez, terminan casi juntas y la dispersión de los
   * finales es pequeña frente a lo que tarda una; si corren en serie, los finales se
   * escalonan y la dispersión pasa a ser ~3 veces esa duración. Medido con el runner real:
   * en serie `spread=635ms` vs `una=290ms` (FALLA) y concurrente `spread=73ms` vs
   * `una=409ms` (PASA).
   */
  it('atiende varias ejecuciones a la vez en vez de encolarlas', async () => {
    const script = slowScript(6_000_000);

    const timed = async () => {
      const startedAt = performance.now();
      const response = await post(payload(script));
      return { response, startedAt, finishedAt: performance.now() };
    };
    const runs = await Promise.all(Array.from({ length: 4 }, timed));

    expect(runs.map((run) => run.response.statusCode)).toEqual([200, 200, 200, 200]);

    const firstFinish = Math.min(...runs.map((run) => run.finishedAt));
    const finishSpread = Math.max(...runs.map((run) => run.finishedAt)) - firstFinish;
    const singleRunMs = firstFinish - Math.min(...runs.map((run) => run.startedAt));
    expect(finishSpread).toBeLessThan(singleRunMs);
  }, 90_000);

  /**
   * Este rechazo es además la prueba estructural de que varias peticiones están vivas a la
   * vez: si el servidor las procesara en serie, cada una sería admitida en su turno con la
   * concurrencia libre y ninguna vería jamás un 503.
   */
  it('rechaza el exceso con 503 reintentable, no con una decisión', async () => {
    // 4 en ejecución + 2 en cola = 6 admitidas; el resto se rechaza sin ejecutarse.
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => post(payload(slowScript(4_000_000)))),
    );
    const busy = responses.filter((response) => response.statusCode === 503);
    expect(busy.length).toBeGreaterThan(0);
    for (const response of busy) {
      expect(response.body.code).toBe('SCRIPT_RUNNER_BUSY');
      // Nunca 422: un 4xx sería "esta petición es inválida", y la petición era correcta.
      expect(response.statusCode).toBe(503);
    }
    // Y las admitidas siguen respondiendo correctamente pese al rechazo de las demás.
    expect(responses.filter((response) => response.statusCode === 200).length).toBeGreaterThan(0);
  }, 90_000);

  it('acota la salida de un script que escribe sin límite', async () => {
    const response = await post({
      ...payload("return { value: 'x'.repeat(5000) };"),
      maxOutputBytes: 1_024,
    });
    expect(response.statusCode).toBe(422);
    expect(response.body.code).toBe('SCRIPT_INVALID_OUTPUT');
  }, 30_000);
});
