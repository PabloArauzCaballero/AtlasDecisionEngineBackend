import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawnSync } from 'node:child_process';
import * as http from 'node:http';
import { DomainException } from '../../common/errors/domain-exception';

export type ScriptLanguage = 'JAVASCRIPT' | 'PYTHON';
type ScriptRunnerMode = 'IN_PROCESS' | 'SIDECAR';

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
for node in ast.walk(tree):
    if isinstance(node, blocked):
        raise ValueError('Unsupported Python statement in RESULT node')
    if isinstance(node, ast.Attribute) and node.attr.startswith('__'):
        raise ValueError('Dunder attributes are not allowed')
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

  constructor(config: ConfigService) {
    this.enabled = config.get<boolean>('SCRIPT_NODES_ENABLED') ?? false;
    this.mode = (config.get<ScriptRunnerMode>('SCRIPT_RUNNER_MODE') ?? 'IN_PROCESS') as ScriptRunnerMode;
    this.socketPath =
      config.get<string>('SCRIPT_RUNNER_SOCKET_PATH') ?? '/var/run/atlas-runner/runner.sock';
    this.timeoutMs = config.get<number>('SCRIPT_NODE_TIMEOUT_MS') ?? 250;
    this.maxSourceBytes = config.get<number>('SCRIPT_NODE_MAX_SOURCE_BYTES') ?? 16_384;
    this.maxOutputBytes = config.get<number>('SCRIPT_NODE_MAX_OUTPUT_BYTES') ?? 65_536;
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
      );
    }
    if (Buffer.byteLength(source, 'utf8') > this.maxSourceBytes) {
      throw new DomainException('SCRIPT_SOURCE_TOO_LARGE', `Script exceeds ${this.maxSourceBytes} bytes`);
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
    });
    const { statusCode, payload } = await this.postToSidecar(body);
    if (statusCode === 200 && payload?.ok) {
      return payload.result as Record<string, unknown>;
    }
    const code = payload?.code ?? 'SCRIPT_EXECUTION_FAILED';
    const message = payload?.message ?? 'RESULT script execution failed';
    throw new DomainException(code, message);
  }

  private postToSidecar(
    body: string,
  ): Promise<{ statusCode: number; payload?: { ok: boolean; code?: string; message?: string; result?: unknown } }> {
    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          socketPath: this.socketPath,
          path: '/execute',
          method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
          timeout: this.timeoutMs + 500,
        },
        (response) => {
          let raw = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => (raw += chunk));
          response.on('end', () => {
            try {
              resolve({ statusCode: response.statusCode ?? 500, payload: raw ? JSON.parse(raw) : undefined });
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
    const input = JSON.stringify({ source, context, timeoutMs: this.timeoutMs });
    const command = language === 'PYTHON' ? process.env.PYTHON_EXECUTABLE || 'python' : process.execPath;
    const args =
      language === 'PYTHON'
        ? ['-I', '-S', '-B', '-c', PYTHON_WRAPPER]
        : ['--max-old-space-size=32', '-e', JS_WRAPPER];
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
      const reason = errorCode === 'ETIMEDOUT' ? 'timed out' : `exited with status ${execution.status ?? 'unknown'}`;
      throw new DomainException('SCRIPT_EXECUTION_FAILED', `RESULT ${language} script ${reason}`);
    }
    let result: unknown;
    try {
      result = JSON.parse(execution.stdout || 'null');
    } catch {
      throw new DomainException('SCRIPT_INVALID_OUTPUT', 'RESULT script must return a JSON-serializable object');
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
