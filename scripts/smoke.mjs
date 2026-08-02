#!/usr/bin/env node
/**
 * Probes health, management catalog and idempotent runtime behavior against a live API, then writes
 * credential-free evidence to smoke/last-run.json.
 */
// Runtime smoke test: exercises a real running instance end to end and records every
// real response (no mocks) to smoke/last-run.json. Each invocation uses a fresh
// idempotency key and replays it within that same run, so persistent development
// databases can execute the smoke repeatedly without colliding with historical payloads.
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const smokeDir = join(repoRoot, 'smoke');

/**
 * Fills only the keys the real environment does not already define from the repository
 * `.env`, so the smoke authenticates with the very credentials the API booted with. Carrying
 * its own copy of the keys made the script drift out of sync with `.env` and fail with 401s
 * that looked like product defects; CI keeps injecting them through the environment, which
 * still wins over the file.
 */
function loadDotEnv(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
}

loadDotEnv(join(repoRoot, '.env'));

/** Credentials are never defaulted: a wrong guess authenticates as nobody and reports a fake failure. */
function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (value) return value;
  console.error(
    `${name} is not configured. Set it in .env (or export it) with the same value the API is running with.`,
  );
  process.exit(1);
}

// Non-secret settings mirror the defaults declared in src/common/config/env.schema.ts.
const baseUrl = process.env.BASE_URL?.trim() || `http://127.0.0.1:${process.env.PORT?.trim() || '3000'}`;
const runtimeApiKey = requiredEnv('RUNTIME_API_KEY');
const managementApiKey = requiredEnv('MANAGEMENT_API_KEY');
const tenantId = process.env.TENANT_ID?.trim() || process.env.BOOTSTRAP_TENANT_ID?.trim() || '1';
const artifactCode = process.env.SMOKE_ARTIFACT_CODE?.trim() || 'BNPL_CREDIT_DECISION';
const environmentCode = process.env.DEFAULT_ENVIRONMENT?.trim() || 'PROD';
const runTag = process.env.SMOKE_RUN_TAG ?? `${Date.now()}-${process.pid}`;

const results = [];
let failures = 0;

async function call(name, { method = 'GET', path, headers = {}, body, assert }) {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const durationMs = Date.now() - startedAt;
  const text = await response.text();
  let parsedBody;
  try {
    parsedBody = text ? JSON.parse(text) : undefined;
  } catch {
    parsedBody = text;
  }

  let passed = true;
  let assertionError;
  try {
    if (assert) assert(response.status, parsedBody);
  } catch (error) {
    passed = false;
    failures += 1;
    assertionError = error instanceof Error ? error.message : String(error);
  }

  const entry = {
    name,
    request: { method, path, hasBody: Boolean(body) },
    status: response.status,
    durationMs,
    response: parsedBody,
    passed,
    ...(assertionError ? { assertionError } : {}),
  };
  results.push(entry);
  console.log(`${passed ? '[OK]' : '[FAIL]'} ${name} (${response.status}, ${durationMs}ms)`);
  if (!passed) console.error(`      ${assertionError}`);
  return entry;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const managementHeaders = {
  'x-api-key': managementApiKey,
  'x-tenant-id': tenantId,
};
const runtimeHeaders = {
  'x-api-key': runtimeApiKey,
  'x-tenant-id': tenantId,
};
// The demo deliberately exercises a broad governed contract. Sharing the fixture with the
// documented manual example prevents smoke requests from drifting into incomplete 422s.
const decisionVariables = JSON.parse(
  await readFile(join(smokeDir, 'demo-applicant.json'), 'utf8'),
);

async function main() {
  await call('health', {
    path: '/health',
    assert: (status, body) => {
      assertEqual(status, 200, 'status');
      assertEqual(body?.status, 'ok', 'body.status');
    },
  });

  const idempotencyKey = `smoke-${runTag}`;
  const first = await call('runtime decision (first call)', {
    method: 'POST',
    path: `/v1/decisions/${artifactCode}`,
    headers: runtimeHeaders,
    body: {
      requestId: idempotencyKey,
      idempotencyKey,
      subjectReference: 'smoke-subject',
      environmentCode,
      variables: decisionVariables,
    },
    assert: (status, body) => {
      assertEqual(status, 200, 'status');
      assertEqual(body?.outcome, 'APPROVED', 'body.outcome');
    },
  });

  await call('runtime decision (idempotent replay)', {
    method: 'POST',
    path: `/v1/decisions/${artifactCode}`,
    headers: runtimeHeaders,
    body: {
      requestId: idempotencyKey,
      idempotencyKey,
      subjectReference: 'smoke-subject',
      environmentCode,
      variables: decisionVariables,
    },
    assert: (status, body) => {
      assertEqual(status, 200, 'status');
      assertEqual(body?.executionId, first.response?.executionId, 'body.executionId (idempotency)');
    },
  });

  // Filtered by code rather than scanning the default page: the scenario asserts that the
  // catalog serves the seeded artifact, not that it happens to sit on page 1. On a
  // long-lived development database the e2e suites leave dozens of E2E_* artifacts behind,
  // which pushed the seed off the first page and failed the smoke for no real reason.
  await call('artifact catalog', {
    path: `/v1/artifacts?search=${encodeURIComponent(artifactCode)}&pageSize=100`,
    headers: managementHeaders,
    assert: (status, body) => {
      assertEqual(status, 200, 'status');
      const found = body?.items?.some((item) => item.artifactCode === artifactCode);
      if (!found) throw new Error(`body.items: expected to find ${artifactCode}`);
    },
  });

  await call('audit chain verification', {
    path: '/v1/audit/chain/verify',
    headers: managementHeaders,
    assert: (status, body) => {
      assertEqual(status, 200, 'status');
      assertEqual(body?.valid, true, 'body.valid');
    },
  });

  await mkdir(smokeDir, { recursive: true });
  const report = {
    startedAt: new Date().toISOString(),
    baseUrl,
    runTag,
    results,
    summary: { total: results.length, passed: results.length - failures, failed: failures, allPassed: failures === 0 },
  };
  await writeFile(join(smokeDir, 'last-run.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nWrote smoke/last-run.json (${report.summary.passed}/${report.summary.total} passed)`);

  if (failures > 0) {
    console.error(`\n${failures} smoke scenario(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll smoke tests passed.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
