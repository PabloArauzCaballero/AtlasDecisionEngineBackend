import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawnSync } from 'node:child_process';
import * as http from 'node:http';
import { DomainException } from '../../common/errors/domain-exception';

export type ScriptLanguage = 'JAVASCRIPT' | 'PYTHON';
type ScriptRunnerMode = 'IN_PROCESS' | 'SIDECAR';

const JS_WRAPPER = String.raw`
const vm = require('node:vm');

// Any object or function reference that crosses from this (outer) realm into the
// sandbox carries a path back out via '.constructor.constructor' — the classic vm
// escape (V8's codeGeneration.strings restriction only covers code generation APIs
// native to the sandboxed context, not outer-realm functions reached by reference).
//
// Se cierra parseando los datos DENTRO del contexto (ver la llamada al final): asi
// nacen con los prototipos del propio sandbox y su cadena no lleva a ninguna parte
// del realm exterior. Antes se hacia con setPrototypeOf(copy, null), que servia
// para objetos pero sobre un ARRAY le arrancaba Array.prototype: el script recibia
// algo sin .map, .reduce ni .sort, de modo que cualquier variable de tipo LISTA era
// inservible y moria con SCRIPT_EXECUTION_FAILED sin explicar la causa.

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => raw += chunk);
process.stdin.on('end', () => {
  const payload = JSON.parse(raw);
  const sandbox = Object.create(null);
  // Viajan como JSON y se parsean dentro del contexto, nunca fuera.
  sandbox.__atlasVariables = JSON.stringify(payload.context.variables || {});
  sandbox.__atlasDecision = JSON.stringify(payload.context.decision || {});
  sandbox.__atlasOutput = JSON.stringify(payload.context.output || {});
  // A bare vm context has no Node-specific globals (setTimeout/setInterval are Node
  // additions, not V8/ECMAScript ones) — assigning undefined primitives here, before
  // context creation, shadows Date and defines otherwise-absent setTimeout/setInterval
  // as no-ops without exposing any outer-realm reference.
  sandbox.Date = undefined;
  sandbox.setTimeout = undefined;
  sandbox.setInterval = undefined;
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  // Runs inside the sandboxed context, so this mutates the context's own native Math —
  // never an outer-realm object — leaving no reference for the script to escape through.
  // Math's other static members stay intact (Math.random is the only non-deterministic one);
  // its property descriptor is {writable:true, configurable:true} per spec, so this succeeds.
  const preamble =
    'Object.defineProperty(Math, "random", { value: () => { throw new Error("Math.random is not allowed"); } });\n';
  // El congelado tambien ocurre dentro: el script no debe poder alterar sus entradas,
  // y congelar aqui usa el Object del propio contexto, no el del realm exterior.
  const freeze =
    'const __atlasFreeze = (o) => { if (o && typeof o === "object") { ' +
    'Object.keys(o).forEach(function (k) { __atlasFreeze(o[k]); }); Object.freeze(o); } return o; };\n';
  const args =
    '(__atlasFreeze(JSON.parse(__atlasVariables)), ' +
    '__atlasFreeze(JSON.parse(__atlasDecision)), ' +
    '__atlasFreeze(JSON.parse(__atlasOutput)))';
  const wrapped =
    freeze +
    '(function (variables, decision, output) { "use strict";\n' +
    preamble +
    payload.source +
    '\n})' +
    args;
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

/**
 * Executes RESULT-node scripts. Two modes:
 *  - IN_PROCESS: spawns python/node as a sibling process of the API. Convenient for local
 *    development and unit tests, but shares the API container's filesystem and network — the
 *    env schema refuses to enable this in production.
 *  - SIDECAR: delegates to the `runner/` service over a Unix socket. That service runs in its
 *    own network-less, capability-dropped, gVisor-sandboxed container (see docker-compose.yml),
 *    which is the actual OS security boundary production requires.
 */
@Injectable()
export class ScriptNodeRunnerService {
  private readonly enabled: boolean;
  private readonly mode: ScriptRunnerMode;
  private readonly socketPath: string;
  private readonly timeoutMs: number;
  private readonly maxSourceBytes: number;
  private readonly maxOutputBytes: number;
  private readonly maxMemoryBytes: number;
  private readonly pythonExecutable: string;

  private readonly isProduction: boolean;

  constructor(config: ConfigService) {
    this.enabled = config.get<boolean>('SCRIPT_NODES_ENABLED') ?? false;
    this.mode = (config.get<ScriptRunnerMode>('SCRIPT_RUNNER_MODE') ??
      'IN_PROCESS') as ScriptRunnerMode;
    this.isProduction = config.get<string>('NODE_ENV') === 'production';
    this.socketPath =
      config.get<string>('SCRIPT_RUNNER_SOCKET_PATH') ?? '/var/run/atlas-runner/runner.sock';
    this.timeoutMs = config.get<number>('SCRIPT_NODE_TIMEOUT_MS') ?? 250;
    this.maxSourceBytes = config.get<number>('SCRIPT_NODE_MAX_SOURCE_BYTES') ?? 16_384;
    this.maxOutputBytes = config.get<number>('SCRIPT_NODE_MAX_OUTPUT_BYTES') ?? 65_536;
    // El runner de JS recibe la cota en sus argumentos (--max-old-space-size); el de Python
    // la recibe en el payload y la aplica con RLIMIT_AS. Mismo techo para los dos.
    this.maxMemoryBytes = (config.get<number>('SCRIPT_NODE_MAX_MEMORY_MB') ?? 32) * 1024 * 1024;
    this.pythonExecutable = config.get<string>('PYTHON_EXECUTABLE') ?? 'python';
  }

  async execute(
    language: ScriptLanguage,
    source: string,
    context: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!this.enabled) {
      throw new DomainException(
        'SCRIPT_NODES_DISABLED',
        'Script RESULT nodes are disabled. Set SCRIPT_NODES_ENABLED=true only with an isolated runner.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (this.isProduction && this.mode !== 'SIDECAR') {
      // Defense in depth beyond env validation: the in-process runner spawns a sibling of
      // the API and is not an OS security boundary, so it must never execute untrusted
      // RESULT-node scripts in production even if configuration validation was bypassed.
      throw new DomainException(
        'SCRIPT_RUNNER_INSECURE_IN_PRODUCTION',
        'The in-process script runner cannot execute in production; use SCRIPT_RUNNER_MODE=SIDECAR.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (Buffer.byteLength(source, 'utf8') > this.maxSourceBytes) {
      throw new DomainException(
        'SCRIPT_SOURCE_TOO_LARGE',
        `Script exceeds ${this.maxSourceBytes} bytes`,
      );
    }
    return this.mode === 'SIDECAR'
      ? this.executeViaSidecar(language, source, context)
      : this.executeInProcess(language, source, context);
  }

  private async executeViaSidecar(
    language: ScriptLanguage,
    source: string,
    context: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const body = JSON.stringify({
      language,
      source,
      context,
      timeoutMs: this.timeoutMs,
      maxSourceBytes: this.maxSourceBytes,
      maxOutputBytes: this.maxOutputBytes,
      maxMemoryBytes: this.maxMemoryBytes,
    });
    const { statusCode, payload } = await this.postToSidecar(body);
    if (statusCode === 200 && payload?.ok) {
      // The sidecar already validates the script's output, but this side must not take that
      // on trust: it is a separate process and the value flows straight into the decision's
      // output contract. Same shape check as the in-process path.
      const result = payload.result;
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new DomainException(
          'SCRIPT_INVALID_OUTPUT',
          'RESULT script must return a JSON object',
        );
      }
      return result as Record<string, unknown>;
    }
    const code = payload?.code ?? 'SCRIPT_EXECUTION_FAILED';
    const message = payload?.message ?? 'RESULT script execution failed';
    // A 5xx from the sidecar means the script never ran (at capacity, crashed, restarting).
    // That must surface as a transient failure so RuntimeService releases the idempotency
    // reservation; as a 4xx it would be cached as this request's terminal decision and the
    // caller could not retry the same key at all.
    throw new DomainException(code, message, this.statusForSidecar(statusCode));
  }

  /** Anything the sidecar answers with 5xx — or does not answer at all — is transient. */
  private statusForSidecar(statusCode: number): HttpStatus {
    return statusCode >= 500 ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.UNPROCESSABLE_ENTITY;
  }

  private postToSidecar(body: string): Promise<{
    statusCode: number;
    payload?: { ok: boolean; code?: string; message?: string; result?: unknown };
  }> {
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          socketPath: this.socketPath,
          path: '/execute',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
          timeout: this.timeoutMs + 500,
        },
        (response) => {
          let raw = '';
          // The sidecar is bounded, but a hung or compromised one must not be able to grow
          // this buffer without limit: the API process would OOM on a response it never
          // asked for. Budget = the script's own output cap plus envelope overhead.
          const maxResponseBytes = this.maxOutputBytes + 4_096;
          let aborted = false;
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            if (aborted) return;
            raw += chunk;
            if (Buffer.byteLength(raw, 'utf8') <= maxResponseBytes) return;
            aborted = true;
            response.destroy();
            reject(
              new DomainException(
                'SCRIPT_INVALID_OUTPUT',
                `The isolated script runner returned more than ${maxResponseBytes} bytes`,
              ),
            );
          });
          response.on('end', () => {
            if (aborted) return;
            try {
              resolve({
                statusCode: response.statusCode ?? 500,
                payload: raw ? JSON.parse(raw) : undefined,
              });
            } catch {
              resolve({ statusCode: response.statusCode ?? 500 });
            }
          });
        },
      );
      request.on('timeout', () => request.destroy(new Error('Script runner sidecar timed out')));
      request.on('error', (error) =>
        reject(
          new DomainException(
            'SCRIPT_RUNNER_UNAVAILABLE',
            `Could not reach the isolated script runner: ${error.message}`,
            HttpStatus.SERVICE_UNAVAILABLE,
          ),
        ),
      );
      request.end(body);
    });
  }

  private executeInProcess(
    language: ScriptLanguage,
    source: string,
    context: Record<string, unknown>,
  ): Record<string, unknown> {
    const input = JSON.stringify({
      source,
      context,
      timeoutMs: this.timeoutMs,
      maxMemoryBytes: this.maxMemoryBytes,
    });
    const command = language === 'PYTHON' ? this.pythonExecutable : process.execPath;
    const args =
      language === 'PYTHON'
        ? ['-I', '-S', '-B', '-c', PYTHON_WRAPPER]
        : [
            `--max-old-space-size=${Math.trunc(this.maxMemoryBytes / (1024 * 1024))}`,
            '-e',
            JS_WRAPPER,
          ];
    const execution = spawnSync(command, args, {
      input,
      encoding: 'utf8',
      timeout: this.timeoutMs + 100,
      maxBuffer: this.maxOutputBytes,
      windowsHide: true,
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT },
    });
    if (execution.error || execution.status !== 0) {
      // Do not reflect stderr: it can contain source lines or sensitive values.
      const errorCode = (execution.error as NodeJS.ErrnoException | undefined)?.code;
      const reason =
        errorCode === 'ETIMEDOUT'
          ? 'timed out'
          : `exited with status ${execution.status ?? 'unknown'}`;
      throw new DomainException('SCRIPT_EXECUTION_FAILED', `RESULT ${language} script ${reason}`);
    }
    let result: unknown;
    try {
      result = JSON.parse(execution.stdout || 'null');
    } catch {
      throw new DomainException(
        'SCRIPT_INVALID_OUTPUT',
        'RESULT script must return a JSON-serializable object',
      );
    }
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new DomainException(
        'SCRIPT_INVALID_OUTPUT',
        language === 'PYTHON'
          ? 'Python RESULT script must assign an object to result'
          : 'JavaScript RESULT script must return an object',
      );
    }
    return result as Record<string, unknown>;
  }
}
