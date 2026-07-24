// Standalone sidecar: executes untrusted RESULT-node scripts (JavaScript or Python) out of
// process from the API. Intentionally dependency-free (Node core modules only) to keep the
// sandboxed container's attack surface minimal. See docs/CONFIGURABLE_OUTPUTS.md.
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SOCKET_PATH = process.env.RUNNER_SOCKET_PATH || '/var/run/atlas-runner/runner.sock';
const HARD_MAX_TIMEOUT_MS = 5_000;
const HARD_MAX_SOURCE_BYTES = 65_536;
const HARD_MAX_OUTPUT_BYTES = 1_048_576;
const HARD_MAX_BODY_BYTES = HARD_MAX_SOURCE_BYTES + 65_536; // source + context/envelope overhead

const JS_WRAPPER = String.raw`
const vm = require('node:vm');
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => raw += chunk);
process.stdin.on('end', () => {
  const payload = JSON.parse(raw);
  const sandbox = Object.create(null);
  sandbox.variables = Object.freeze(payload.context.variables || {});
  sandbox.decision = Object.freeze(payload.context.decision || {});
  sandbox.output = Object.freeze(payload.context.output || {});
  sandbox.Date = undefined;
  sandbox.setTimeout = undefined;
  sandbox.setInterval = undefined;
  sandbox.Math = Object.create(Math);
  Object.defineProperty(sandbox.Math, 'random', { value: () => { throw new Error('Math.random is not allowed'); } });
  Object.freeze(sandbox.Math);
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  const wrapped = '(function (variables, decision, output) { "use strict";\n' + payload.source + '\n})(variables, decision, output)';
  const result = new vm.Script(wrapped, { filename: 'atlas-result-node.js' })
    .runInContext(context, { timeout: payload.timeoutMs });
  process.stdout.write(JSON.stringify(result));
});
`;

const PYTHON_WRAPPER = String.raw`
import ast, json, sys
payload = json.load(sys.stdin)
tree = ast.parse(payload['source'], filename='atlas-result-node.py', mode='exec')
blocked = (ast.Import, ast.ImportFrom, ast.Global, ast.Nonlocal, ast.ClassDef, ast.With, ast.AsyncWith, ast.Try, ast.Raise)
# str.format()/format_map() resolve "{0.__class__.__bases__[0]...}"-style field specs at
# runtime via getattr chains inside a plain string constant — no ast.Attribute node is ever
# produced, so the dunder-attribute check below never sees it. This is the classic Python
# restricted-builtins sandbox escape (class introspection -> __subclasses__ -> real
# __builtins__ -> exec). Blocking the call sites closes it without dropping str() itself.
for node in ast.walk(tree):
    if isinstance(node, blocked):
        raise ValueError('Unsupported Python statement in RESULT node')
    if isinstance(node, ast.Attribute) and node.attr.startswith('__'):
        raise ValueError('Dunder attributes are not allowed')
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in ('format', 'format_map'):
        raise ValueError('String formatting methods are not allowed')
safe_builtins = {
    'abs': abs, 'bool': bool, 'dict': dict, 'enumerate': enumerate, 'float': float,
    'int': int, 'len': len, 'list': list, 'max': max, 'min': min, 'range': range,
    'round': round, 'str': str, 'sum': sum, 'tuple': tuple, 'zip': zip,
}
scope = {
    'variables': payload['context'].get('variables', {}),
    'decision': payload['context'].get('decision', {}),
    'output': payload['context'].get('output', {}),
}
exec(compile(tree, 'atlas-result-node.py', 'exec'), {'__builtins__': safe_builtins}, scope)
sys.stdout.write(json.dumps(scope.get('result')))
`;

function clamp(value, fallback, hardMax) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, hardMax);
}

function runScript(language, source, context, timeoutMs, maxOutputBytes) {
  const input = JSON.stringify({ source, context, timeoutMs });
  const command = language === 'PYTHON' ? process.env.PYTHON_EXECUTABLE || 'python3' : process.execPath;
  const args =
    language === 'PYTHON'
      ? ['-I', '-S', '-B', '-c', PYTHON_WRAPPER]
      : ['--max-old-space-size=32', '-e', JS_WRAPPER];
  const execution = spawnSync(command, args, {
    input,
    encoding: 'utf8',
    timeout: timeoutMs + 100,
    maxBuffer: maxOutputBytes,
    windowsHide: true,
    env: {
      PATH: process.env.PATH,
      PYTHONDONTWRITEBYTECODE: '1',
    },
  });
  if (execution.error || execution.status !== 0) {
    // Do not reflect stderr: it can contain source lines or sensitive values.
    const errorCode = execution.error?.code;
    const reason = errorCode === 'ETIMEDOUT' ? 'timed out' : `exited with status ${execution.status ?? 'unknown'}`;
    return { ok: false, code: 'SCRIPT_EXECUTION_FAILED', message: `RESULT ${language} script ${reason}` };
  }
  let result;
  try {
    result = JSON.parse(execution.stdout || 'null');
  } catch {
    return { ok: false, code: 'SCRIPT_INVALID_OUTPUT', message: 'RESULT script must return a JSON-serializable object' };
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return {
      ok: false,
      code: 'SCRIPT_INVALID_OUTPUT',
      message:
        language === 'PYTHON'
          ? 'Python RESULT script must assign an object to result'
          : 'JavaScript RESULT script must return an object',
    };
  }
  return { ok: true, result };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > HARD_MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, statusCode, body) {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json) });
  res.end(json);
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/execute') {
    return send(res, 404, { ok: false, code: 'NOT_FOUND', message: 'Unknown endpoint' });
  }
  let raw;
  try {
    raw = await readBody(req);
  } catch (error) {
    return send(res, error.statusCode ?? 400, { ok: false, code: 'BODY_ERROR', message: error.message });
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return send(res, 400, { ok: false, code: 'INVALID_JSON', message: 'Body must be valid JSON' });
  }
  const language = String(payload.language ?? '').toUpperCase();
  if (language !== 'JAVASCRIPT' && language !== 'PYTHON') {
    return send(res, 400, { ok: false, code: 'INVALID_LANGUAGE', message: `Unsupported language ${language}` });
  }
  const source = String(payload.source ?? '');
  const maxSourceBytes = clamp(payload.maxSourceBytes, HARD_MAX_SOURCE_BYTES, HARD_MAX_SOURCE_BYTES);
  if (Buffer.byteLength(source, 'utf8') > maxSourceBytes) {
    return send(res, 400, { ok: false, code: 'SCRIPT_SOURCE_TOO_LARGE', message: `Script exceeds ${maxSourceBytes} bytes` });
  }
  const context = payload.context && typeof payload.context === 'object' ? payload.context : {};
  const timeoutMs = clamp(payload.timeoutMs, 250, HARD_MAX_TIMEOUT_MS);
  const maxOutputBytes = clamp(payload.maxOutputBytes, HARD_MAX_OUTPUT_BYTES, HARD_MAX_OUTPUT_BYTES);

  const outcome = runScript(language, source, context, timeoutMs, maxOutputBytes);
  return send(res, outcome.ok ? 200 : 422, outcome);
});

const socketDir = path.dirname(SOCKET_PATH);
if (!fs.existsSync(socketDir)) fs.mkdirSync(socketDir, { recursive: true });
if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);

server.listen(SOCKET_PATH, () => {
  fs.chmodSync(SOCKET_PATH, 0o770);
  // eslint-disable-next-line no-console
  console.log(`atlas script-runner listening on ${SOCKET_PATH}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  });
}
