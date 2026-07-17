#!/usr/bin/env node
// Runtime smoke test: exercises a real running instance end to end and records every
// real response (no mocks) to smoke/last-run.json. Each invocation uses a fresh
// idempotency key and replays it within that same run, so persistent development
// databases can execute the smoke repeatedly without colliding with historical payloads.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
const runtimeApiKey = process.env.RUNTIME_API_KEY ?? 'local-runtime-key-change-before-sharing';
const managementApiKey = process.env.MANAGEMENT_API_KEY ?? 'local-management-key-change-before-sharing';
const tenantId = process.env.TENANT_ID ?? '1';
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
const decisionVariables = {
  kyc_status: 'VERIFIED',
  consent_active: true,
  age: 30,
  fraud_signal: false,
  bureau_score: 760,
  monthly_income: 8000,
  requested_amount: 2500,
};

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
    path: '/v1/decisions/BNPL_CREDIT_DECISION',
    headers: runtimeHeaders,
    body: {
      requestId: idempotencyKey,
      idempotencyKey,
      subjectReference: 'smoke-subject',
      environmentCode: 'PROD',
      variables: decisionVariables,
    },
    assert: (status, body) => {
      assertEqual(status, 200, 'status');
      assertEqual(body?.outcome, 'APPROVED', 'body.outcome');
    },
  });

  await call('runtime decision (idempotent replay)', {
    method: 'POST',
    path: '/v1/decisions/BNPL_CREDIT_DECISION',
    headers: runtimeHeaders,
    body: {
      requestId: idempotencyKey,
      idempotencyKey,
      subjectReference: 'smoke-subject',
      environmentCode: 'PROD',
      variables: decisionVariables,
    },
    assert: (status, body) => {
      assertEqual(status, 200, 'status');
      assertEqual(body?.executionId, first.response?.executionId, 'body.executionId (idempotency)');
    },
  });

  await call('artifact catalog', {
    path: '/v1/artifacts',
    headers: managementHeaders,
    assert: (status, body) => {
      assertEqual(status, 200, 'status');
      const found = body?.items?.some((item) => item.artifactCode === 'BNPL_CREDIT_DECISION');
      if (!found) throw new Error('body.items: expected to find BNPL_CREDIT_DECISION');
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

  const outputDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'smoke');
  await mkdir(outputDir, { recursive: true });
  const report = {
    startedAt: new Date().toISOString(),
    baseUrl,
    runTag,
    results,
    summary: { total: results.length, passed: results.length - failures, failed: failures, allPassed: failures === 0 },
  };
  await writeFile(join(outputDir, 'last-run.json'), `${JSON.stringify(report, null, 2)}\n`);
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
