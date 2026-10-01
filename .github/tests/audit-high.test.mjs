/** ATL-11 · `scripts/audit-high.mjs` no aprueba una auditoría que no llegó a completarse. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = new URL('../../scripts/audit-high.mjs', import.meta.url).pathname;
const BIT = { info: 1, low: 2, moderate: 4, high: 8, critical: 16 };
const line = (type, data) => `${JSON.stringify({ type, data })}\n`;
const adv = (severity, id = 1) =>
  line('auditAdvisory', {
    resolution: { id, path: 'a>b' },
    advisory: { id, severity, module_name: `pkg-${id}` },
  });
const sum = (c = {}) =>
  line('auditSummary', {
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, ...c },
    dependencies: 10,
    devDependencies: 0,
    optionalDependencies: 0,
    totalDependencies: 10,
  });
const mask = (c) => Object.entries(c).reduce((m, [k, v]) => (v ? m | BIT[k] : m), 0);

async function run(plan, args = []) {
  const dir = mkdtempSync(join(tmpdir(), 'audit-high-'));
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
  writeFileSync(
    join(dir, 'yarn'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const plan = JSON.parse(fs.readFileSync(${JSON.stringify(join(dir, 'plan.json'))}, 'utf8'));
fs.appendFileSync(${JSON.stringify(join(dir, 'args.log'))}, process.argv.slice(2).join(' ') + '\\n');
if (plan.stdout) process.stdout.write(plan.stdout);
if (plan.stderr) process.stderr.write(plan.stderr);
process.exit(plan.exit);
`,
  );
  chmodSync(join(dir, 'yarn'), 0o755);
  const child = spawn(process.execPath, [script, ...args], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (out += c));
  const [status] = await once(child, 'close');
  return { status, out, dir };
}

test('limpio y sólo INFO/moderados (exit de yarn 0, 1 o 4) pasan', async () => {
  assert.equal((await run({ stdout: sum(), exit: 0 })).status, 0);
  assert.equal((await run({ stdout: adv('info') + sum({ info: 1 }), exit: 1 })).status, 0);
  assert.equal((await run({ stdout: adv('moderate') + sum({ moderate: 2 }), exit: 4 })).status, 0);
});

test('high o critical bloquean con 1', async () => {
  assert.equal((await run({ stdout: adv('high') + sum({ high: 1 }), exit: 8 })).status, 1);
  assert.equal((await run({ stdout: adv('critical') + sum({ critical: 1 }), exit: 16 })).status, 1);
});

test('ATL-11: exit 1 sin reporte, error de red, JSON truncado, exit 32 y salida vacía NO pasan (antes daban «sin avisos»)', async () => {
  const casos = [
    { stdout: '', exit: 1 },
    { stdout: '', exit: 0 },
    { stdout: '', stderr: line('error', 'getaddrinfo ENOTFOUND registry.yarnpkg.com'), exit: 1 },
    {
      stdout: adv('moderate') + '{"type":"auditAdvisory","data":{"reso\n' + sum({ moderate: 1 }),
      exit: 4,
    },
    { stdout: sum(), exit: 32 },
    { stdout: sum({ high: 1 }), exit: 0 },
  ];
  for (const caso of casos) {
    const r = await run(caso);
    assert.equal(r.status, 3, JSON.stringify(caso));
    assert.match(r.out, /NO se completó/);
  }
});

test('alcance: producción por defecto (--groups dependencies) y todo con --todos', async () => {
  const prod = await run({ stdout: sum(), exit: 0 });
  assert.match(readLog(prod.dir), /audit --json --groups dependencies/);
  const todo = await run({ stdout: sum(), exit: 0 }, ['--todos']);
  assert.doesNotMatch(readLog(todo.dir), /--groups/);
});

import { readFileSync } from 'node:fs';
const readLog = (dir) => readFileSync(join(dir, 'args.log'), 'utf8');
