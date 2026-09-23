import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';

const sha = 'a'.repeat(40);

async function runScenario({ ready = true, commit = sha, cache = 'redis' } = {}) {
  const paths = [];
  const server = createServer((request, response) => {
    paths.push(request.url);
    response.setHeader('content-type', 'application/json');
    if (request.url === '/health/live') {
      response.end(
        JSON.stringify({
          status: 'ok',
          service: 'atlas-decision-engine-backend',
          role: 'API',
          version: '2.0.0',
          commit,
        }),
      );
    } else if (request.url === '/health/ready') {
      response.statusCode = ready ? 200 : 503;
      response.end(
        JSON.stringify({
          status: ready ? 'ready' : 'not_ready',
          checks: { database: ready ? 'ok' : 'error', cache },
        }),
      );
    } else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    const child = spawn(process.execPath, ['scripts/post-deploy-smoke.mjs'], {
      env: {
        ...process.env,
        SMOKE_BASE_URL: `http://127.0.0.1:${address.port}`,
        TARGET_SHA: sha,
        SMOKE_ATTEMPTS: '1',
      },
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const [status] = await once(child, 'close');
    const result = { status, stderr };
    return { result, paths };
  } finally {
    server.close();
  }
}

test('acepta live, ready y versión del SHA validado', async () => {
  const { result, paths } = await runScenario();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(paths, ['/health/live', '/health/ready']);
});

test('rechaza un commit viejo aunque Coolify haya terminado', async () => {
  const { result } = await runScenario({ commit: 'b'.repeat(40) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SHA/);
});

test('rechaza readiness degradado', async () => {
  const { result } = await runScenario({ ready: false });
  assert.notEqual(result.status, 0);
});

test('rechaza fallback de caché en memoria', async () => {
  const { result } = await runScenario({ cache: 'memory' });
  assert.notEqual(result.status, 0);
});
