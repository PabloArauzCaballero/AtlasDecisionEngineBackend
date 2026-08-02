/**
 * Standalone sidecar for untrusted RESULT scripts. It stays dependency-free, networkless and
 * bounded so imported business logic never inherits the API process's authority.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SOCKET_PATH = process.env.RUNNER_SOCKET_PATH || '/var/run/atlas-runner/runner.sock';
const HARD_MAX_TIMEOUT_MS = 5_000;
const HARD_MAX_SOURCE_BYTES = 65_536;
const HARD_MAX_OUTPUT_BYTES = 1_048_576;
const HARD_MAX_BODY_BYTES = HARD_MAX_SOURCE_BYTES + 65_536; // source + context/envelope overhead
const HARD_MAX_MEMORY_BYTES = 512 * 1024 * 1024;

// How many scripts may run at once, and how many may wait. The runner used to execute with
// spawnSync, which blocks this single-threaded server for the whole script: concurrency was
// effectively 1, so one script sitting on its 5s ceiling stalled every other tenant's
// decision behind it. Executing asynchronously fixes that, but unbounded forking would just
// move the failure — the container caps pids (64) and CPU (0.5), so admission is bounded
// here and excess load is refused with a retryable 503 instead of thrashing.
const MAX_CONCURRENCY = boundedEnv('RUNNER_MAX_CONCURRENCY', 4, 1, 32);
const MAX_QUEUE = boundedEnv('RUNNER_MAX_QUEUE', 64, 0, 1_024);

function boundedEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

const JS_WRAPPER = String.raw`
const vm = require('node:vm');

// Any object or function reference that crosses from this (outer) realm into the
// sandbox carries a path back out via '.constructor.constructor' — the classic vm
// escape (V8's codeGeneration.strings restriction only covers code generation APIs
// native to the sandboxed context, not outer-realm functions reached by reference).
// Decision data has no functions, so recursively stripping its prototype closes that
// path for 'variables'/'decision'/'output'; nothing else outer-realm is exposed.
// Object.freeze() alone does NOT close it: a frozen object keeps its prototype.
function toNullProto(value) {
  if (Array.isArray(value)) {
    const copy = value.map(toNullProto);
    Object.setPrototypeOf(copy, null);
    return Object.freeze(copy);
  }
  if (value && typeof value === 'object') {
    const copy = Object.create(null);
    for (const key of Object.keys(value)) copy[key] = toNullProto(value[key]);
    return Object.freeze(copy);
  }
  return value;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => raw += chunk);
process.stdin.on('end', () => {
  const payload = JSON.parse(raw);
  const sandbox = Object.create(null);
  sandbox.variables = toNullProto(payload.context.variables || {});
  sandbox.decision = toNullProto(payload.context.decision || {});
  sandbox.output = toNullProto(payload.context.output || {});
  // A bare vm context has no Node-specific globals (setTimeout/setInterval are Node
  // additions, not V8/ECMAScript ones) — assigning undefined primitives here, before
  // context creation, shadows Date and defines otherwise-absent setTimeout/setInterval
  // as no-ops without exposing any outer-realm reference.
  sandbox.Date = undefined;
  sandbox.setTimeout = undefined;
  sandbox.setInterval = undefined;
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  // Math must be neutered from INSIDE the context: 'Object.create(Math)' would hand the
  // script the outer realm's Math as a prototype, and Math.constructor.constructor is the
  // outer Function constructor — the same escape as above by another door. Running the
  // preamble in-context mutates the context's own native Math instead.
  const preamble =
    'Object.defineProperty(Math, "random", { value: () => { throw new Error("Math.random is not allowed"); } });\n';
  const wrapped = '(function (variables, decision, output) { "use strict";\n' + preamble + payload.source + '\n})(variables, decision, output)';
  const result = new vm.Script(wrapped, { filename: 'atlas-result-node.js' })
    .runInContext(context, { timeout: payload.timeoutMs });
  process.stdout.write(JSON.stringify(result));
});
`;

const PYTHON_WRAPPER = String.raw`
import ast, json, sys
payload = json.load(sys.stdin)
# Cota de memoria por proceso (§9.3). El runner de JS ya recibe --max-old-space-size; Python
# no tenia ninguna, asi que un script desbocado podia crecer hasta el limite del CONTENEDOR y
# llevarse por delante las ejecuciones vecinas — mas probable desde que el sidecar atiende
# varias a la vez. Medido: a 32 MiB un script normal corre igual y una fuga muere a los ~18 MiB.
# RLIMIT_AS solo existe en POSIX; en Windows (solo desarrollo) no hay nada que aplicar.
try:
    import resource
    _max_bytes = int(payload.get('maxMemoryBytes') or 0)
    if _max_bytes > 0:
        resource.setrlimit(resource.RLIMIT_AS, (_max_bytes, _max_bytes))
except (ImportError, ValueError, OSError):
    pass
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
    'round': round, 'str': str, 'sum': sum, 'tuple': tuple, 'zip': zip, 'sorted': sorted,
}
scope = {
    'variables': payload['context'].get('variables', {}),
    'decision': payload['context'].get('decision', {}),
    'output': payload['context'].get('output', {}),
}
# Un único diccionario como globals Y locals: con globals y locals separados, una
# función definida por el script queda en locals y su cuerpo no la ve al ejecutarse
# (busca en globals), así que cualquier helper que llame a otro helper falla con
# NameError. Los builtins restringidos siguen siendo los mismos.
scope['__builtins__'] = safe_builtins
exec(compile(tree, 'atlas-result-node.py', 'exec'), scope)
sys.stdout.write(json.dumps(scope.get('result')))
`;

function clamp(value, fallback, hardMax) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, hardMax);
}

/** Spawns the wrapper, feeds it the payload and collects bounded stdout. Never rejects. */
function execute(language, source, context, timeoutMs, maxOutputBytes, maxMemoryBytes) {
  const input = JSON.stringify({ source, context, timeoutMs, maxMemoryBytes });
  const command = language === 'PYTHON' ? process.env.PYTHON_EXECUTABLE || 'python3' : process.execPath;
  const args =
    language === 'PYTHON'
      ? ['-I', '-S', '-B', '-c', PYTHON_WRAPPER]
      : [`--max-old-space-size=${Math.trunc(maxMemoryBytes / (1024 * 1024))}`, '-e', JS_WRAPPER];

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        windowsHide: true,
        env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1' },
      });
    } catch {
      resolve({ status: null, reason: 'spawn-failed', stdout: '' });
      return;
    }

    let stdout = '';
    let settled = false;
    let reason = null;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    // spawnSync enforced the output cap through maxBuffer; asynchronously it has to be
    // enforced by hand, or a script printing in a loop grows this string without limit.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout, 'utf8') <= maxOutputBytes) return;
      reason = 'output-too-large';
      child.kill('SIGKILL');
    });
    // stderr is drained and discarded: it can carry source lines or sensitive values, and
    // an unread pipe would eventually block the child.
    child.stderr.resume();

    const timer = setTimeout(() => {
      reason = 'timed out';
      child.kill('SIGKILL');
    }, timeoutMs + 100);
    timer.unref?.();

    child.on('error', () => finish({ status: null, reason: reason ?? 'spawn-failed', stdout }));
    child.on('close', (status) => finish({ status, reason, stdout }));

    child.stdin.on('error', () => undefined); // the child may die before stdin is drained
    child.stdin.end(input);
  });
}

async function runScript(language, source, context, timeoutMs, maxOutputBytes, maxMemoryBytes) {
  const execution = await execute(language, source, context, timeoutMs, maxOutputBytes, maxMemoryBytes);
  if (execution.reason === 'output-too-large') {
    return {
      ok: false,
      code: 'SCRIPT_INVALID_OUTPUT',
      message: `RESULT script wrote more than ${maxOutputBytes} bytes`,
    };
  }
  if (execution.reason || execution.status !== 0) {
    // Do not reflect stderr: it can contain source lines or sensitive values.
    const reason = execution.reason ?? `exited with status ${execution.status ?? 'unknown'}`;
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

/** Admission control: at most MAX_CONCURRENCY running, at most MAX_QUEUE waiting. */
let running = 0;
const waiting = [];

function admit() {
  if (running < MAX_CONCURRENCY) {
    running += 1;
    return Promise.resolve(true);
  }
  if (waiting.length >= MAX_QUEUE) return Promise.resolve(false);
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) next(true);
  else running -= 1;
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
  // Cota de memoria del proceso hijo de Python (§9.3). El de JS ya la lleva en sus args.
  const maxMemoryBytes = clamp(payload.maxMemoryBytes, 32 * 1024 * 1024, HARD_MAX_MEMORY_BYTES);

  if (!(await admit())) {
    // 503, not 422: the script never ran, so this is a capacity signal the caller may retry
    // — never a decision about the request itself.
    return send(res, 503, {
      ok: false,
      code: 'SCRIPT_RUNNER_BUSY',
      message: 'The isolated script runner is at capacity',
    });
  }
  try {
    const outcome = await runScript(language, source, context, timeoutMs, maxOutputBytes, maxMemoryBytes);
    return send(res, outcome.ok ? 200 : 422, outcome);
  } finally {
    release();
  }
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
